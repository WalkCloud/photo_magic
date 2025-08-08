# Photo Magic API 使用示例

## S3 存储结构使用示例

### 1. 文件上传

上传原始图片到 `original/` 文件夹：

```javascript
// POST /api/v1/files/upload
const formData = new FormData();
formData.append('file', imageFile);

const response = await fetch('/api/v1/files/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

const result = await response.json();
// result.s3Key: "original/user123/file456.jpg"
```

### 2. 图像处理

处理图片并保存到 `processed/` 文件夹：

```javascript
// POST /api/v1/images/process
const response = await fetch('/api/v1/images/process', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fileId: 'file456',
    processType: 'remove-background',
    parameters: {
      format: 'png'
    }
  })
});

const result = await response.json();
// result.processedUrl: "https://bucket.s3.region.amazonaws.com/processed/user123/file456_remove-background.png"
```

### 3. 文件查询

查询文件信息，包括处理后的版本：

```javascript
// GET /api/v1/files/{fileId}
const response = await fetch('/api/v1/files/file456', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const fileInfo = await response.json();
/*
{
  "fileId": "file456",
  "originalName": "photo.jpg",
  "s3Key": "original/user123/file456.jpg",
  "url": "https://bucket.s3.region.amazonaws.com/original/user123/file456.jpg",
  "processedKeys": {
    "remove-background": "processed/user123/file456_remove-background.png",
    "enhance-clarity": "processed/user123/file456_enhance-clarity.jpg"
  },
  "status": "ACTIVE"
}
*/
```

## 支持的处理类型

### 1. 背景移除 (remove-background)

```javascript
{
  "fileId": "file456",
  "processType": "remove-background",
  "parameters": {
    "format": "png" // 输出格式
  }
}
```

### 2. 清晰度增强 (enhance-clarity)

```javascript
{
  "fileId": "file456",
  "processType": "enhance-clarity",
  "parameters": {
    "level": "medium" // low, medium, high
  }
}
```

### 3. 图像扩展 (extend-image)

```javascript
{
  "fileId": "file456",
  "processType": "extend-image",
  "parameters": {
    "direction": "right", // left, right, up, down
    "ratio": 1.5 // 扩展比例
  }
}
```

### 4. 对象消除 (object-removal)

```javascript
{
  "fileId": "file456",
  "processType": "object-removal",
  "parameters": {
    "coordinates": {
      "x": 100,
      "y": 150,
      "width": 50,
      "height": 80
    }
  }
}
```

## S3 生命周期管理

- **Original 文件夹**: 12小时后自动删除
- **Processed 文件夹**: 12小时后自动删除
- **Temporary 文件夹**: 2小时后自动删除

## 错误处理

```javascript
// 处理失败的响应示例
{
  "error": "PROCESSING_FAILED",
  "message": "图像处理失败",
  "details": "不支持的文件格式"
}
```

## 最佳实践

1. **文件上传后立即处理**: 避免用户等待时间过长
2. **缓存处理结果**: 相同参数的处理结果可以复用
3. **监控临时文件**: 确保临时文件及时清理
4. **错误重试**: 处理失败时提供重试机制
5. **进度反馈**: 长时间处理任务提供进度更新