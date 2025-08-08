# S3存储结构设计方案

## 概述

基于Photo Magic应用的需求，设计三层文件夹结构来管理不同类型的图片文件：
- **Original**: 存储用户上传的原始图片
- **Processed**: 存储AI处理后的图片
- **Temporary**: 存储临时处理文件

## 文件夹结构设计

```
s3-bucket/
├── original/
│   └── {userId}/
│       └── {fileId}.{extension}
├── processed/
│   └── {userId}/
│       └── {fileId}/
│           ├── remove-background.{extension}
│           ├── enhance-clarity-720p.{extension}
│           ├── enhance-clarity-1080p.{extension}
│           ├── enhance-clarity-2k.{extension}
│           ├── image-extension.{extension}
│           └── object-removal.{extension}
└── temporary/
    └── {userId}/
        └── {sessionId}/
            ├── input.{extension}
            ├── mask.png
            └── processing.{extension}
```

## 详细说明

### 1. Original文件夹
- **路径格式**: `original/{userId}/{fileId}.{extension}`
- **用途**: 存储用户上传的原始图片
- **特点**:
  - 永久保存，作为所有处理的基础
  - 支持多种格式：jpg, png, webp等
  - 文件名使用UUID确保唯一性

### 2. Processed文件夹
- **路径格式**: `processed/{userId}/{fileId}/{processingType}.{extension}`
- **用途**: 存储AI处理后的最终图片
- **处理类型**:
  - `remove-background`: 背景移除结果
  - `enhance-clarity-{resolution}`: 清晰度增强结果（720p/1080p/2k）
  - `image-extension`: 图片扩展结果
  - `object-removal`: 对象消除结果
- **特点**:
  - 按原始文件ID分组，便于管理
  - 支持同一原图的多种处理结果
  - 可供前端直接调用展示

### 3. Temporary文件夹
- **路径格式**: `temporary/{userId}/{sessionId}/{fileName}`
- **用途**: 存储处理过程中的临时文件
- **文件类型**:
  - `input.{extension}`: 处理输入文件
  - `mask.png`: 涂抹消除的蒙版文件
  - `processing.{extension}`: 处理中间结果
- **特点**:
  - 按会话ID分组，支持并发处理
  - 设置生命周期策略，自动清理过期文件
  - 用于异步处理的中间存储

## 生命周期管理

### 文件夹清理策略
```json
{
  "Rules": [
    {
      "ID": "DeleteOriginalFiles",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "original/"
      },
      "Expiration": {
        "Hours": 12
      }
    },
    {
      "ID": "DeleteProcessedFiles",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "processed/"
      },
      "Expiration": {
        "Hours": 12
      }
    },
    {
      "ID": "DeleteTemporaryFiles",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "temporary/"
      },
      "Expiration": {
        "Hours": 2
      }
    }
  ]
}
```

### Original和Processed文件保留策略
- Original文件：12小时后自动删除
- Processed文件：12小时后自动删除

## 权限设计

### 用户访问权限
- 用户只能访问自己userId下的文件
- Original文件：读写权限
- Processed文件：读权限
- Temporary文件：读写权限（限制在自己的sessionId下）

### Lambda函数权限
- 文件上传Lambda：Original和Temporary写权限
- 图像处理Lambda：所有文件夹读写权限
- 文件查询Lambda：Original和Processed读权限

## 实现建议

### 1. 更新上传逻辑
```javascript
// 当前：files/{userId}/{fileId}.{extension}
// 更新为：original/{userId}/{fileId}.{extension}
const s3Key = `original/${userId}/${fileId}.${fileExtension}`;
```

### 2. 处理结果存储
```javascript
// 处理完成后存储到processed文件夹
const processedKey = `processed/${userId}/${fileId}/${processingType}.${extension}`;
```

### 3. 临时文件管理
```javascript
// 生成会话ID用于临时文件隔离
const sessionId = uuidv4();
const tempKey = `temporary/${userId}/${sessionId}/${fileName}`;
```

## 数据库字段更新

### Files表新增字段
```javascript
{
  fileId: 'string',           // 主键
  userId: 'string',           // 用户ID
  originalKey: 'string',      // original/{userId}/{fileId}.{ext}
  processedKeys: {            // 处理结果键值对
    'remove-background': 'processed/{userId}/{fileId}/remove-background.jpg',
    'enhance-clarity-1080p': 'processed/{userId}/{fileId}/enhance-clarity-1080p.jpg'
  },
  temporaryKeys: ['string'],  // 临时文件键数组
  createdAt: 'string',
  updatedAt: 'string'
}
```

## 优势

1. **清晰的文件分类**：不同用途的文件分别存储，便于管理
2. **用户隔离**：每个用户的文件独立存储，确保数据安全
3. **版本管理**：支持同一原图的多种处理结果
4. **自动清理**：临时文件自动过期删除，节省存储成本
5. **扩展性强**：易于添加新的处理类型和存储策略
6. **性能优化**：按用户和文件ID分层，提高查询效率