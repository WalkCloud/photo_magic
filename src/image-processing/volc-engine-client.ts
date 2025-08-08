import * as crypto from 'crypto';
import * as CryptoJS from 'crypto-js';

interface VolcEngineConfig {
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export class VolcEngineClient {
  private config: VolcEngineConfig;
  private readonly baseUrl = 'https://visual.volcengineapi.com';

  constructor(accessKey: string, secretKey: string) {
    this.config = {
      accessKey,
      secretKey,
      region: 'cn-north-1',
      service: 'cv'
    };
  }

  // 生成签名
  private generateSignature(method: string, uri: string, query: string, headers: Record<string, string>, body: string, timestamp: string): string {
    // 1. 创建规范请求
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map(key => `${key.toLowerCase()}:${headers[key]}`)
      .join('\n');
    
    const signedHeaders = Object.keys(headers)
      .sort()
      .map(key => key.toLowerCase())
      .join(';');
    
    const hashedPayload = crypto.createHash('sha256').update(body).digest('hex');
    
    const canonicalRequest = [
      method,
      uri,
      query,
      canonicalHeaders,
      '',
      signedHeaders,
      hashedPayload
    ].join('\n');
    
    // 2. 创建待签名字符串
    const algorithm = 'HMAC-SHA256';
    const credentialScope = `${timestamp.substr(0, 8)}/${this.config.region}/${this.config.service}/request`;
    const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    
    const stringToSign = [
      algorithm,
      timestamp,
      credentialScope,
      hashedCanonicalRequest
    ].join('\n');
    
    // 3. 计算签名
    const kDate = crypto.createHmac('sha256', this.config.secretKey).update(timestamp.substr(0, 8)).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(this.config.region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(this.config.service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('request').digest();
    
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    
    return signature;
  }

  // 创建签名请求
  private createSignedRequest(method: string, path: string, query: Record<string, string>, body: any): SignedRequest {
    const timestamp = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '');
    const bodyString = JSON.stringify(body);
    
    // 构建查询字符串
    const queryString = Object.keys(query)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
      .join('&');
    
    // 基础头部
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Host': 'visual.volcengineapi.com',
      'X-Date': timestamp,
      'X-Content-Sha256': crypto.createHash('sha256').update(bodyString).digest('hex')
    };
    
    // 生成签名
    const signature = this.generateSignature(method, path, queryString, headers, bodyString, timestamp);
    
    // 添加授权头
    const credentialScope = `${timestamp.substr(0, 8)}/${this.config.region}/${this.config.service}/request`;
    const signedHeaders = Object.keys(headers).sort().map(key => key.toLowerCase()).join(';');
    
    headers['Authorization'] = [
      'HMAC-SHA256',
      `Credential=${this.config.accessKey}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`
    ].join(', ');
    
    return {
      url: `${this.baseUrl}${path}?${queryString}`,
      headers,
      body: bodyString
    };
  }

  // 调用背景移除API
  async removeBackground(imageUrl: string, isSubscribed: boolean): Promise<any> {
    const requestBody = {
      image_urls: [imageUrl],
      only_mask: 3, // 返回原图大小的BGRA透明前景图
      refine_mask: 0, // 不对边缘增强
      req_key: 'saliency_seg',
      rgb: [-1, -1, -1], // 返回透明底图
      logo_info: {
        add_logo: !isSubscribed, // 订阅用户不添加水印
        position: 0, // 右下角
        language: 1, // 英文
        opacity: 0.3,
        logo_text_content: 'Photo Magic'
      }
    };

    const query = {
      Action: 'CVProcess',
      Version: '2022-08-31'
    };

    const signedRequest = this.createSignedRequest('POST', '/', query, requestBody);

    try {
      const response = await fetch(signedRequest.url, {
        method: 'POST',
        headers: signedRequest.headers,
        body: signedRequest.body
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Volc Engine API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      
      // 检查业务错误码
      const volcResult = result as any;
      if (volcResult.code !== 10000) {
        throw new Error(`Volc Engine business error: ${volcResult.code} - ${volcResult.message}`);
      }

      return result;
    } catch (error) {
      console.error('Volc Engine API call failed:', error);
      throw error;
    }
  }

  // 测试API连接
  async testConnection(): Promise<boolean> {
    try {
      // 使用一个测试图片URL进行连接测试
      const testImageUrl = 'https://example.com/test.jpg';
      await this.removeBackground(testImageUrl, true);
      return true;
    } catch (error) {
      console.error('Volc Engine connection test failed:', error);
      return false;
    }
  }
}

// 导出单例实例
let volcEngineClient: VolcEngineClient | null = null;

export function getVolcEngineClient(): VolcEngineClient {
  if (!volcEngineClient) {
    const accessKey = process.env.VOLC_ACCESS_KEY;
    const secretKey = process.env.VOLC_SECRET_KEY;
    
    if (!accessKey || !secretKey) {
      throw new Error('Volc Engine credentials not configured');
    }
    
    volcEngineClient = new VolcEngineClient(accessKey, secretKey);
  }
  
  return volcEngineClient;
}