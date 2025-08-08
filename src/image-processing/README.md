# 图像处理服务 (Image Processing Service)

## 概述

图像处理服务是Photo Magic项目的核心组件之一，提供各种AI驱动的图像处理功能。目前已实现背景移除功能，后续将扩展更多图像处理能力。

## 功能特性

### 1. 背景移除服务 (Remove Background)

- **功能**: 使用火山引擎AI技术智能移除图像背景
- **输入**: 支持JPG、JPEG、PNG、BMP等常见格式
- **输出**: 返回BGRA透明背景的图像
- **水印**: 根据用户订阅状态控制水印显示
  - 普通用户: 右下角显示"Photo Magic"英文水印
  - 订阅用户: 无水印

## API接口

### 背景移除

**POST** `/api/v1/images/remove-background`

#### 请求头
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

#### 请求体
```json
{
  "fileId": "string",
  "originalUrl": "string"
}
```

#### 响应
```json
{
  "success": true,
  "taskId": "string",
  "message": "Background removal task started"
}
```

### 查询处理状态

**GET** `/api/v1/images/remove-background/{taskId}`

#### 请求头
```
Authorization: Bearer <JWT_TOKEN>
```

#### 响应
```json
{
  "success": true,
  "data": {
    "taskId": "string",
    "status": "completed|processing|failed",
    "resultUrl": "string",
    "createdAt": "string",
    "completedAt": "string"
  }
}
```

## 技术架构

### 核心组件

1. **remove-background.ts**: 背景移除主处理逻辑
2. **remove-background-status.ts**: 任务状态查询接口
3. **volc-engine-client.ts**: 火山引擎API客户端

### 数据流程

1. 用户上传图像文件到S3
2. 调用背景移除API，创建处理任务
3. 异步调用火山引擎API进行图像处理
4. 处理结果保存到S3，更新任务状态
5. 用户通过状态查询API获取处理结果

### 存储结构

```
S3 Bucket Structure:
├── uploads/
│   └── {userId}/
│       └── {fileId}/
│           ├── original.{ext}     # 原始文件
│           └── processed/
│               └── remove-bg.png  # 背景移除结果
```

## 环境变量

```bash
# AWS配置
AWS_REGION=us-east-1
S3_BUCKET_NAME=photo-magic-assets

# 数据库表
FILES_TABLE=PhotoMagic-FilesTable
USERS_TABLE=PhotoMagic-UsersTable
TASKS_TABLE=PhotoMagic-TasksTable

# JWT配置
JWT_SECRET=your-jwt-secret-key

# 火山引擎配置
VOLC_ACCESS_KEY=your-volc-access-key
VOLC_SECRET_KEY=your-volc-secret-key
```

## 部署说明

### Lambda函数配置

- **运行时**: Node.js 18.x
- **内存**: 1024MB (背景移除), 256MB (状态查询)
- **超时**: 5分钟 (背景移除), 30秒 (状态查询)
- **权限**: DynamoDB读写、S3读写

### CDK部署

```bash
# 安装依赖
npm install

# 部署到AWS
cdk deploy
```

## 测试

```bash
# 运行单元测试
node test-remove-background.js
```

## 错误处理

### 常见错误码

- `400`: 请求参数错误
- `401`: JWT令牌无效或过期
- `404`: 文件或任务不存在
- `500`: 服务器内部错误
- `61003`: 图片中不包含可用于分割的物体

### 重试机制

- 火山引擎API调用失败时自动重试3次
- 指数退避策略，避免频繁请求

## 监控和日志

- 所有API调用都会记录到CloudWatch Logs
- 关键指标通过CloudWatch Metrics监控
- 错误和异常会触发SNS通知

## 后续扩展

计划实现的功能:
- 图像清晰度增强
- 图像扩展
- 对象消除
- 批量处理
- 自定义水印