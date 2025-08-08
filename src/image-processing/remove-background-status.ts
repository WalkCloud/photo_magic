import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as jwt from 'jsonwebtoken';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

const TASKS_TABLE = process.env.TASKS_TABLE_NAME!;
const JWT_SECRET = process.env.JWT_SECRET!;

// 验证JWT Token
function verifyToken(token: string): any {
  try {
    return jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
}

// 获取任务状态
async function getTaskStatus(taskId: string): Promise<any> {
  const result = await dynamoClient.send(new GetItemCommand({
    TableName: TASKS_TABLE,
    Key: marshall({ taskId })
  }));
  
  if (!result.Item) {
    throw new Error('Task not found');
  }
  
  return unmarshall(result.Item);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
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
    if (event.httpMethod !== 'GET') {
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

    // 获取路径参数中的taskId
    const taskId = event.pathParameters?.taskId;
    if (!taskId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'taskId is required' })
      };
    }

    // 获取任务状态
    const task = await getTaskStatus(taskId);
    
    // 验证任务所有者
    if (task.userId !== userId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Access denied' })
      };
    }

    // 构建响应
    const response: any = {
      taskId: task.taskId,
      status: task.status,
      taskType: task.taskType,
      fileId: task.fileId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
    
    // 如果任务完成，添加结果URL
    if (task.status === 'completed' && (task as any).result) {
      response.result = (task as any).result;
    }
    
    // 如果任务失败，添加错误信息
    if (task.status === 'failed' && (task as any).error) {
      response.error = (task as any).error;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Handler error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage === 'Task not found') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Task not found' })
      };
    }
    
    if (errorMessage === 'Invalid token') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};