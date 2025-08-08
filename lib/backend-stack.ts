import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Tables
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      tableName: 'PhotoMagic-Users',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Add GSI for email lookup
    usersTable.addGlobalSecondaryIndex({
      indexName: 'EmailIndex',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for cognito sub lookup
    usersTable.addGlobalSecondaryIndex({
      indexName: 'CognitoSubIndex',
      partitionKey: { name: 'cognitoSub', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for username lookup
    usersTable.addGlobalSecondaryIndex({
      indexName: 'UsernameIndex',
      partitionKey: { name: 'username', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const tasksTable = new dynamodb.Table(this, 'TasksTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      tableName: 'PhotoMagic-Tasks',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const subscriptionsTable = new dynamodb.Table(this, 'SubscriptionsTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      tableName: 'PhotoMagic-Subscriptions',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const usageTable = new dynamodb.Table(this, 'UsageTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      tableName: 'PhotoMagic-Usage',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const filesTable = new dynamodb.Table(this, 'FilesTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      tableName: 'PhotoMagic-Files',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Add GSI for file ID lookup
    filesTable.addGlobalSecondaryIndex({
      indexName: 'FileIdIndex',
      partitionKey: { name: 'fileId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // S3 Bucket
    const assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production
      autoDeleteObjects: true, // NOT recommended for production
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
          allowedOrigins: ['*'], // Restrict this in production
          allowedHeaders: ['*'],
        },
      ],
      lifecycleRules: [
        {
          id: 'DeleteOriginalFiles',
          enabled: true,
          prefix: 'original/',
          expiration: cdk.Duration.days(1),
        },
        {
          id: 'DeleteProcessedFiles',
          enabled: true,
          prefix: 'processed/',
          expiration: cdk.Duration.days(1),
        },
        {
          id: 'DeleteTemporaryFiles',
          enabled: true,
          prefix: 'temporary/',
          expiration: cdk.Duration.days(1),
        }
      ],
    });

    // Cognito User Pool
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      autoVerify: { email: true },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
        userPool,
        authFlows: {
            userPassword: true,
            userSrp: true,
        },
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'AssetsBucketName', { value: assetsBucket.bucketName });

    // API Gateway
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: 'PhotoMagicApi',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
        cognitoUserPools: [userPool],
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });

    // API Gateway Resources and Methods
    const apiV1 = api.root.addResource('api').addResource('v1');
    const auth = apiV1.addResource('auth');

    // Auth routes

    // Lambda Functions for Authentication
    const registerLambda = new lambda.Function(this, 'RegisterLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'register.handler',
        code: lambda.Code.fromAsset('src/auth'),
        environment: {
            USER_POOL_ID: userPool.userPoolId,
            CLIENT_ID: userPoolClient.userPoolClientId,
            USERS_TABLE: usersTable.tableName,
            SUBSCRIPTIONS_TABLE: subscriptionsTable.tableName,
            USAGE_TABLE: usageTable.tableName,
            REGION: this.region,
        },
        timeout: cdk.Duration.seconds(30),
    });

    const loginLambda = new lambda.Function(this, 'LoginLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'login.handler',
        code: lambda.Code.fromAsset('src/auth'),
        environment: {
            USER_POOL_ID: userPool.userPoolId,
            CLIENT_ID: userPoolClient.userPoolClientId,
            USERS_TABLE: usersTable.tableName,
            SUBSCRIPTIONS_TABLE: subscriptionsTable.tableName,
            USAGE_TABLE: usageTable.tableName,
            REGION: this.region,
        },
        timeout: cdk.Duration.seconds(30),
    });

    const passwordLambda = new lambda.Function(this, 'PasswordLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'password.handler',
        code: lambda.Code.fromAsset('src/auth'),
        environment: {
            USER_POOL_ID: userPool.userPoolId,
            CLIENT_ID: userPoolClient.userPoolClientId,
            USERS_TABLE: usersTable.tableName,
            SUBSCRIPTIONS_TABLE: subscriptionsTable.tableName,
            USAGE_TABLE: usageTable.tableName,
            REGION: this.region,
        },
        timeout: cdk.Duration.seconds(30),
    });

    const logoutLambda = new lambda.Function(this, 'LogoutLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'logout.handler',
        code: lambda.Code.fromAsset('src/auth'),
        environment: {
            USER_POOL_ID: userPool.userPoolId,
            CLIENT_ID: userPoolClient.userPoolClientId,
            USERS_TABLE: usersTable.tableName,
            SUBSCRIPTIONS_TABLE: subscriptionsTable.tableName,
            USAGE_TABLE: usageTable.tableName,
            REGION: this.region,
        },
        timeout: cdk.Duration.seconds(30),
    });

    // File Service Lambda Functions
    const fileUploadLambda = new lambda.Function(this, 'FileUploadLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'upload.handler',
        code: lambda.Code.fromAsset('src/file', {
            bundling: {
                image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                command: [
                    'bash', '-c',
                    'cp -r /asset-input/* /asset-output/ && cd /asset-output && npm install --production'
                ],
            },
        }),
        environment: {
            FILES_TABLE: filesTable.tableName,
            S3_BUCKET: assetsBucket.bucketName,
            USER_POOL_ID: userPool.userPoolId,
            REGION: this.region,
        },
        timeout: cdk.Duration.seconds(60),
        memorySize: 512,
    });

    // Image Processing Lambda Functions
    const removeBackgroundLambda = new lambda.Function(this, 'RemoveBackgroundLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'remove-background.handler',
        code: lambda.Code.fromAsset('src/image-processing', {
            bundling: {
                image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                command: [
                    'bash', '-c',
                    'cp -r /asset-input/* /asset-output/ && cd /asset-output && npm install --production'
                ],
            },
        }),
        environment: {
            FILES_TABLE: filesTable.tableName,
            USERS_TABLE: usersTable.tableName,
            TASKS_TABLE: tasksTable.tableName,
            S3_BUCKET_NAME: assetsBucket.bucketName,
            JWT_SECRET: 'your-jwt-secret-key', // Should be from environment or secrets manager
            VOLC_ACCESS_KEY: 'your-volc-access-key', // Should be from environment or secrets manager
            VOLC_SECRET_KEY: 'your-volc-secret-key', // Should be from environment or secrets manager
            AWS_REGION: this.region,
        },
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
    });

    const removeBackgroundStatusLambda = new lambda.Function(this, 'RemoveBackgroundStatusLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'remove-background-status.handler',
        code: lambda.Code.fromAsset('src/image-processing', {
            bundling: {
                image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                command: [
                    'bash', '-c',
                    'cp -r /asset-input/* /asset-output/ && cd /asset-output && npm install --production'
                ],
            },
        }),
        environment: {
            TASKS_TABLE_NAME: tasksTable.tableName,
            JWT_SECRET: 'your-jwt-secret-key', // Should be from environment or secrets manager
            AWS_REGION: this.region,
        },
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
    });

    const fileQueryLambda = new lambda.Function(this, 'FileQueryLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'query.handler',
        code: lambda.Code.fromAsset('src/file', {
            bundling: {
                image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                command: [
                    'bash', '-c',
                    'cp -r /asset-input/* /asset-output/ && cd /asset-output && npm install --production'
                ],
            },
        }),
        environment: {
            FILES_TABLE: filesTable.tableName,
            S3_BUCKET: assetsBucket.bucketName,
            USER_POOL_ID: userPool.userPoolId,
            REGION: this.region,
        },
        timeout: cdk.Duration.seconds(30),
    });

    // Grant permissions to Lambda functions
    usersTable.grantReadWriteData(registerLambda);
    subscriptionsTable.grantReadWriteData(registerLambda);
    usageTable.grantReadWriteData(registerLambda);
    
    usersTable.grantReadWriteData(loginLambda);
    subscriptionsTable.grantReadWriteData(loginLambda);
    usageTable.grantReadWriteData(loginLambda);
    
    usersTable.grantReadWriteData(passwordLambda);
    subscriptionsTable.grantReadWriteData(passwordLambda);
    usageTable.grantReadWriteData(passwordLambda);
    
    usersTable.grantReadWriteData(logoutLambda);
    subscriptionsTable.grantReadWriteData(logoutLambda);
    usageTable.grantReadWriteData(logoutLambda);

    // Grant permissions to file service Lambda functions
    filesTable.grantReadWriteData(fileUploadLambda);
    assetsBucket.grantReadWrite(fileUploadLambda);
    filesTable.grantReadData(fileQueryLambda);
    assetsBucket.grantRead(fileQueryLambda);

    // Grant permissions to image processing Lambda functions
    filesTable.grantReadWriteData(removeBackgroundLambda);
    usersTable.grantReadData(removeBackgroundLambda);
    tasksTable.grantReadWriteData(removeBackgroundLambda);
    assetsBucket.grantReadWrite(removeBackgroundLambda);
    
    tasksTable.grantReadData(removeBackgroundStatusLambda);

    // Lambda integrations
    const registerIntegration = new apigateway.LambdaIntegration(registerLambda);
    const loginIntegration = new apigateway.LambdaIntegration(loginLambda);
    const passwordIntegration = new apigateway.LambdaIntegration(passwordLambda);
    const logoutIntegration = new apigateway.LambdaIntegration(logoutLambda);
    const fileUploadIntegration = new apigateway.LambdaIntegration(fileUploadLambda);
    const fileQueryIntegration = new apigateway.LambdaIntegration(fileQueryLambda);
    const removeBackgroundIntegration = new apigateway.LambdaIntegration(removeBackgroundLambda);
    const removeBackgroundStatusIntegration = new apigateway.LambdaIntegration(removeBackgroundStatusLambda);

    // Placeholder Lambda for other endpoints
    const placeholderLambda = new lambda.Function(this, 'PlaceholderLambda', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline('exports.handler = async () => { return { statusCode: 200, body: "OK" }; };'),
    });

    const placeholderIntegration = new apigateway.LambdaIntegration(placeholderLambda);

    // Auth routes
    const register = auth.addResource('register');
    register.addMethod('POST', registerIntegration); // Public endpoint
    
    const registerConfirm = register.addResource('confirm');
    registerConfirm.addMethod('POST', registerIntegration); // Public endpoint

    const login = auth.addResource('login');
    login.addMethod('POST', loginIntegration);

    const refresh = auth.addResource('refresh');
    refresh.addMethod('POST', loginIntegration); // Use login lambda for refresh

    const logout = auth.addResource('logout');
    logout.addMethod('POST', logoutIntegration, { authorizer }); // Protected

    const sendVerification = auth.addResource('send-verification');
    sendVerification.addMethod('POST', registerIntegration); // Use register lambda

    const verifyEmail = auth.addResource('verify-email');
    verifyEmail.addMethod('POST', registerIntegration); // Use register lambda

    const verifyEmailExistence = auth.addResource('verify-email-existence');
    verifyEmailExistence.addMethod('POST', registerIntegration); // Use register lambda

    const forgotPassword = auth.addResource('forgot-password');
    forgotPassword.addMethod('POST', passwordIntegration);

    const resetPassword = auth.addResource('reset-password');
    resetPassword.addMethod('POST', passwordIntegration);

    const google = auth.addResource('google');
    google.addMethod('POST', placeholderIntegration);

    const apple = auth.addResource('apple');
    apple.addMethod('POST', placeholderIntegration);

    // File service routes
    const files = apiV1.addResource('files');
    const upload = files.addResource('upload');
    upload.addMethod('POST', fileUploadIntegration); // Handle authorization in Lambda
    const fileById = files.addResource('{fileId}');
    fileById.addMethod('GET', fileQueryIntegration); // Handle authorization in Lambda

    // Image processing routes
    const images = apiV1.addResource('images');
    const removeBackground = images.addResource('remove-background');
    removeBackground.addMethod('POST', removeBackgroundIntegration); // Handle authorization in Lambda
    const removeBackgroundStatus = removeBackground.addResource('{taskId}');
    removeBackgroundStatus.addMethod('GET', removeBackgroundStatusIntegration); // Handle authorization in Lambda
    const extendImage = images.addResource('extend-image');
    extendImage.addMethod('POST', placeholderIntegration);
    const extendImageStatus = extendImage.addResource('{taskId}');
    extendImageStatus.addMethod('GET', placeholderIntegration);
    const enhanceClarity = images.addResource('enhance-clarity');
    enhanceClarity.addMethod('POST', placeholderIntegration);
    const enhanceClarityStatus = enhanceClarity.addResource('{taskId}');
    enhanceClarityStatus.addMethod('GET', placeholderIntegration);
    const objectRemoval = images.addResource('object-removal');
    objectRemoval.addMethod('POST', placeholderIntegration);
    const objectRemovalStatus = objectRemoval.addResource('{taskId}');
    objectRemovalStatus.addMethod('GET', placeholderIntegration);

    // User management routes
    const users = apiV1.addResource('users');
        const profile = users.addResource('profile');
    profile.addMethod('GET', placeholderIntegration, { authorizer });
    profile.addMethod('PUT', placeholderIntegration, { authorizer });

    // Metering routes
    const usage = apiV1.addResource('usage');
    const stats = usage.addResource('stats');
    const check = usage.addResource('check');
    const record = usage.addResource('record');

    // Subscription routes
    const subscriptions = apiV1.addResource('subscriptions');
    const plans = subscriptions.addResource('plans');
    const subscribe = subscriptions.addResource('subscribe');
    const purchaseIncrement = subscriptions.addResource('purchase-increment');
    const status = subscriptions.addResource('status');



  }
}
