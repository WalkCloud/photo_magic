import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as jwt from 'jsonwebtoken';
import crypto from 'crypto';

interface RemoveBackgroundRequest {
  fileId: string;
  parameters?: {
    format?: string;
  };
}

interface VolcEngineResponse {
  code: number;
  data: {
    binary_data_base64: string[];
    algorithm_base_resp: {
      status_code: number;
      status_message: string;
    };
  };
  message: string;
  request_id: string;
}

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

const BUCKET_NAME = process.env.S3_BUCKET_NAME!;
const FILES_TABLE = process.env.FILES_TABLE_NAME!;
const USERS_TABLE = process.env.USERS_TABLE_NAME!;
const TASKS_TABLE = process.env.TASKS_TABLE_NAME!;
const JWT_SECRET = process.env.JWT_SECRET!;
const VOLC_ACCESS_KEY = process.env.VOLC_ACCESS_KEY!;
const VOLC_SECRET_KEY = process.env.VOLC_SECRET_KEY!;

// 验证JWT Token
function verifyToken(token: string): any {
  try {
    return jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
}

// 检查用户订阅状态
async function checkUserSubscription(userId: string): Promise<boolean> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ userId })
    }));
    
    if (!result.Item) {
      return false;
    }
    
    const user = unmarshall(result.Item);
    return user.subscriptionStatus === 'active';
  } catch (error) {
    console.error('Error checking user subscription:', error);
    return false;
  }
}

// 获取文件信息
async function getFileInfo(fileId: string): Promise<any> {
  const result = await dynamoClient.send(new GetItemCommand({
    TableName: FILES_TABLE,
    Key: marshall({ fileId })
  }));
  
  if (!result.Item) {
    throw new Error('File not found');
  }
  
  return unmarshall(result.Item);
}

// 从S3获取图片URL
async function getImageUrl(key: string): Promise<string> {
  // 生成预签名URL用于火山引擎API访问
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });
  
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// 调用火山引擎背景移除API
async function callVolcEngineAPI(imageUrl: string, isSubscribed: boolean): Promise<VolcEngineResponse> {
  const { getVolcEngineClient } = await import('./volc-engine-client.js');
  const client = getVolcEngineClient();
  
  return await client.removeBackground(imageUrl, isSubscribed);
}

// 保存处理结果到S3
async function saveProcessedImage(fileId: string, base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const key = `processed/${fileId}_remove-background.png`;
  
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'image/png'
  }));
  
  return key;
}

// 更新文件记录
async function updateFileRecord(fileId: string, processedKey: string): Promise<void> {
  await dynamoClient.send(new UpdateItemCommand({
    TableName: FILES_TABLE,
    Key: marshall({ fileId }),
    UpdateExpression: 'SET processedKeys = list_append(if_not_exists(processedKeys, :empty_list), :new_key)',
    ExpressionAttributeValues: marshall({
      ':empty_list': [],
      ':new_key': [processedKey]
    })
  }));
}

// 创建任务记录
async function createTaskRecord(taskId: string, userId: string, fileId: string): Promise<void> {
  await dynamoClient.send(new UpdateItemCommand({
    TableName: TASKS_TABLE,
    Key: marshall({ taskId }),
    UpdateExpression: 'SET userId = :userId, fileId = :fileId, taskType = :taskType, #status = :status, createdAt = :createdAt',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: marshall({
      ':userId': userId,
      ':fileId': fileId,
      ':taskType': 'remove-background',
      ':status': 'processing',
      ':createdAt': new Date().toISOString()
    })
  }));
}

// 更新任务状态
async function updateTaskStatus(taskId: string, status: string, result?: any, error?: string): Promise<void> {
  const updateExpression = 'SET #status = :status, updatedAt = :updatedAt';
  const expressionAttributeValues: any = {
    ':status': status,
    ':updatedAt': new Date().toISOString()
  };
  
  if (result) {
    updateExpression.concat(', result = :result');
    expressionAttributeValues[':result'] = result;
  }
  
  if (error) {
    updateExpression.concat(', error = :error');
    expressionAttributeValues[':error'] = error;
  }
  
  await dynamoClient.send(new UpdateItemCommand({
    TableName: TASKS_TABLE,
    Key: marshall({ taskId }),
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: marshall(expressionAttributeValues)
  }));
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };

  try {
    // 处理CORS预检请求
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers,
        body: ''
      };
    }

    // 验证请求方法
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    // 验证Authorization头
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Authorization header required' })
      };
    }

    // 验证JWT Token
    const decoded = verifyToken(authHeader);
    const userId = decoded.userId;

    // 解析请求体
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body required' })
      };
    }

    const request: RemoveBackgroundRequest = JSON.parse(event.body);
    
    // 验证必需参数
    if (!request.fileId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'fileId is required' })
      };
    }

    // 生成任务ID
    const taskId = crypto.randomUUID();

    // 创建任务记录
    await createTaskRecord(taskId, userId, request.fileId);

    // 异步处理背景移除
    processBackgroundRemoval(taskId, userId, request.fileId).catch(error => {
      console.error('Background removal processing error:', error);
      updateTaskStatus(taskId, 'failed', undefined, error.message);
    });

    return {
      statusCode: 202,
      headers,
      body: JSON.stringify({
        taskId,
        status: 'processing',
        message: 'Background removal task started'
      })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// 异步处理背景移除
async function processBackgroundRemoval(taskId: string, userId: string, fileId: string): Promise<void> {
  try {
    // 获取文件信息
    const fileInfo = await getFileInfo(fileId);
    
    // 检查用户订阅状态
    const isSubscribed = await checkUserSubscription(userId);
    
    // 获取原始图片URL
    const imageUrl = await getImageUrl(fileInfo.originalKey);
    
    // 调用火山引擎API
    const volcResponse = await callVolcEngineAPI(imageUrl, isSubscribed);
    
    if (volcResponse.code !== 10000) {
      throw new Error(`Volc Engine API error: ${volcResponse.message}`);
    }
    
    // 保存处理结果
    const processedKey = await saveProcessedImage(fileId, volcResponse.data.binary_data_base64[0]);
    
    // 更新文件记录
    await updateFileRecord(fileId, processedKey);
    
    // 更新任务状态为完成
    await updateTaskStatus(taskId, 'completed', {
      processedKey,
      originalSize: {
        width: fileInfo.width,
        height: fileInfo.height
      },
      processedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Background removal processing error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await updateTaskStatus(taskId, 'failed', undefined, errorMessage);
    throw error;
  }
}