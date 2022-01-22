import * as cdk from 'aws-cdk-lib';
import lambda = require('aws-cdk-lib/aws-lambda');
import sfn = require('aws-cdk-lib/aws-stepfunctions');
import sfnTasks = require('aws-cdk-lib/aws-stepfunctions-tasks');
import events = require('aws-cdk-lib/aws-events');
import sqs = require('aws-cdk-lib/aws-sqs');
import kms = require('aws-cdk-lib/aws-kms');
import logs = require('aws-cdk-lib/aws-logs');
import iam = require('aws-cdk-lib/aws-iam');
import events_targets = require('aws-cdk-lib/aws-events-targets');
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';

export class StepFunctionMapEventbridgeStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // KMS Key for bucket encrpytion
    const kmsKey = new kms.Key(this, 'stepfunctionmapeventbridgestack-encryption-key', {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY,       // Auto destroy if removed from stack
      pendingWindow: Duration.days(7)             // Delete after 7 day once delete is triggered
    });


    const computingBus = new events.EventBus(this, "computingBus")

    new cdk.CfnOutput(this, "BusName", { value: computingBus.eventBusName });

    const computingBusDLQ = new sqs.Queue(this, 'ComputingBusDLQ', {
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey
    });

    // Enable adding suppressions to computingBusDLQ to notify CDK-NAG that 
    // This computingBusDLQ sqs queue is already a deadletter queue for eventbridge
    // bus computingBus so itself does not need another deadletter queue
    NagSuppressions.addResourceSuppressions(
      computingBusDLQ,
      [{ id: 'AwsSolutions-SQS3', reason: 'This computingBusDLQ sqs queue is already a deadletter queue for eventbridge bus computingBus so itself does not need another deadletter queue' }],
      true
    );

    /**
     * Lambda
     * 
     * Computing Lambda used to simulate calculation, will actually sleep for 5 sec
     * And use task token to notify step function that this particular one calculation is completed
     */

    // Source identifer for event from this computing lambda
    let computingSourceName = 'com.computing.lambda'
    let computingDetailTypeName = 'ComputingType'

    // Role computingLambdaRole
    // Role used by computing lamdba, need to explictly declare to assign to the policy of Lambda basic execution role + XRay Daemon write access to work correctly
    // Explictly declare to allow future control + also to add nag supression policy to notify about basic lambda managed policy requirements
    const computingLambdaRole = new iam.Role(this, "computing_lambda_role", {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    });

    // Add minimum AWS lambda roles (from cloudwatch logs and xray)
    // https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html
    computingLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    computingLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));


    const computingLambda = new lambda.Function(this, 'computing_lambda', {
      runtime: lambda.Runtime.NODEJS_14_X,
      role: computingLambdaRole,
      code: lambda.Code.fromAsset('lambda_fns'),
      handler: 'computing_lambda.lambda_handler',
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE               // Enable xray tracing to complete tracing from step function to xray
    });

    // Enable adding suppressions to AwsSolutions-IAM4 to notify CDK-NAG that 
    // This computingLambda only used required AWS Managed Lambda policies. These polices according to documentation https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html is recommended to use over manually add policy. As Lambda will need to access random cloudwatch/XRAY endpoint base on input requirement
    // The wildcard is coming from AWS Managed Lambda policy due to how Lambda dynamically create cloudwatch/xray setup on start up
    NagSuppressions.addResourceSuppressions(
      computingLambdaRole,
      [
        { id: 'AwsSolutions-IAM4', reason: 'This computingLambdaRole only used required AWS Managed Lambda policies. These polices according to documentation https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html is recommended to use over manually add policy. As Lambda will need to access random cloudwatch/XRAY endpoint base on input requirement' },
        { id: 'AwsSolutions-IAM5', reason: 'This wildcard permission comes from AWS Managed Lambda policies for cloudwatch/xray, which is required as lambda cannot control cloudwatch log group name in advance and require wildcard permission to create on fly so cannot be replaced' }
      ],
      true
    );

    /**
     * Lambda
     * 
     * Summary Lambda present the next step after all calculation for given request is completed and ready to proceed to next step
     * This is currently just a dummy function, but in real world setup, this is the place to trigger next step
     * 
     * Create a Node Lambda with the table name passed in as an environment variable
     */

    // Role computingLambdaRole
    // Role used by summary lamdba, need to explictly declare to assign to the policy of Lambda basic execution role + XRay Daemon write access to work correctly
    // Explictly declare to allow future control + also to add nag supression policy to notify about basic lambda managed policy requirements
    const summaryLambdaRole = new iam.Role(this, "summary_lambda_role", {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    });

    // Add minimum AWS lambda roles (from cloudwatch logs and xray)
    // https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html
    summaryLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    summaryLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

    const summaryLambda = new lambda.Function(this, 'summary_lambda', {
      runtime: lambda.Runtime.NODEJS_14_X,
      role: summaryLambdaRole,
      code: lambda.Code.fromAsset('lambda_fns'),
      handler: 'summary_lambda.lambda_handler',
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE               // Enable xray tracing to complete tracing from step function to xray
    });

    // Enable adding suppressions to AwsSolutions-IAM4 to notify CDK-NAG that 
    // This computingLambda only used required AWS Managed Lambda policies. These polices according to documentation https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html is recommended to use over manually add policy. As Lambda will need to access random cloudwatch/XRAY endpoint base on input requirement
    // The wildcard is coming from AWS Managed Lambda policy due to how Lambda dynamically create cloudwatch/xray setup on start up
    NagSuppressions.addResourceSuppressions(
      summaryLambdaRole,
      [
        { id: 'AwsSolutions-IAM4', reason: 'This computingLambdaRole only used required AWS Managed Lambda policies. These polices according to documentation https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html is recommended to use over manually add policy. As Lambda will need to access random cloudwatch/XRAY endpoint base on input requirement' },
        { id: 'AwsSolutions-IAM5', reason: 'This wildcard permission comes from AWS Managed Lambda policies for cloudwatch/xray, which is required as lambda cannot control cloudwatch log group name in advance and require wildcard permission to create on fly so cannot be replaced' }
      ],
      true
    );

    /**
     * 
     * Step Function
     * 
     * Pre-Processing Step function
     * 
     */

    // Source identifer for event from this step function
    let preprocessSourceName = 'com.preprocess.stepfunction'
    let preprocessDetailTypeName = 'PreProcessType'

    /**
     * Step Function Task
     * 
     * pushEventTask - Push input item into target event bus
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-tasks-readme.html#put-events
     * 
     * Target Data Object Model within detail
     * "detail": {
     *   payload: {
     *    "request": {"caseId": "123"},
     *    "requestId": "123456"
     *  },
     *   "taskToken": "<tasktoken>"
     * }
     * So need to reassemble the pass in object as there is no direct way to inject a new field into existing
    */
    const pushEventTask = new sfnTasks.EventBridgePutEvents(this, 'PushEvent', {
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      entries: [{
        detail: sfn.TaskInput.fromObject({
          // Important: 
          // Need to use like this to get "payload.$" : "$", if using TaskInput.fromOjbect('$'), 
          // will result one extra layer "payload":{ "type": 0, "values.$":"$"} 
          // so nested TaskInput (TaskInput within TaskInput result in different formating), in this case should need to be string 
          payload: sfn.JsonPath.entirePayload,
          taskToken: sfn.JsonPath.taskToken
        }),
        eventBus: computingBus,
        detailType: preprocessDetailTypeName,
        source: preprocessSourceName,
      }],
    });

    /**
     * Step Function Task
     * 
     * PushAllItemsToEventBridge - Map iterator to map through incoming items concurrently
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-readme.html
     *
    */
    const pushAllItemsToEventBridge = new sfn.Map(this, 'PushAllItemsToEventBridge', {
      inputPath: '$',
      itemsPath: '$.requests',
      parameters: {
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        request: sfn.JsonPath.stringAt('$$.Map.Item.Value')
      },
    }).iterator(pushEventTask);

    // Create event bus rule to invoke computing Lambda
    // From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-events-targets-readme.html
    const invokeComplLambdaRule = new events.Rule(this, 'InvokeComplLambdaRule', {
      eventBus: computingBus,
      eventPattern: {
        source: [preprocessSourceName],
      },
    });

    invokeComplLambdaRule.addTarget(new events_targets.LambdaFunction(computingLambda, {
      deadLetterQueue: computingBusDLQ,             // Optional: add a dead letter queue
      retryAttempts: 2,                             // Optional: set the max number of retry attempts
    }));

    /**
     * Step Function Task
     * 
     * invokeSummaryTask - Invoke the summary lambda to signify that all calculations for given request is done
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-readme.html
     * 
    */
    const invokeSummaryTask = new sfnTasks.LambdaInvoke(this, 'InvokeSummary', {
      lambdaFunction: summaryLambda,
      inputPath: '$'
    });


    /**
     * CloudWatch log group for increment Step Function
     * Will capture all logs from increment
     */
    const mapEventBridgeProcessLogGroup = new logs.LogGroup(this, 'MapEventBridgeProcessLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY     // Clean up the log with stack
    });


    /**
     * Step Function
     * 
     * mapEventBridgeProcess Step function for Pre-processing trigger to preform following
     * pushAllItemsToEventBridgeTask - Map iterator to map through incoming items concurrently
     *    TaskPushEvent - Push input item into target event bus with a callback token, wait for the token to complete before proceed
     * invokeSummaryTask - Task only got called if all calculations done, and invoke lambda to signify next step to begin
     */
    const mapEventBridgeProcess = new sfn.StateMachine(this, 'MapEventBridgeProcess', {
      definition: pushAllItemsToEventBridge.next(invokeSummaryTask),
      tracingEnabled: true,                          // Enable X-Ray
      logs: {
        destination: mapEventBridgeProcessLogGroup,          // Enable full logs to cloudwatch log group
        level: sfn.LogLevel.ALL,
      },
    });

    // Grant permission for processSFN to put events into computing eventbus
    computingBus.grantPutEventsTo(mapEventBridgeProcess);
    // Grant permission for processSFN to called summary Lambda
    summaryLambda.grantInvoke(mapEventBridgeProcess);
    // Give role task response permissions to the computing Lambda so it can notify step function with callback token
    mapEventBridgeProcess.grantTaskResponse(computingLambda);

    // Enable adding suppressions to AwsSolutions-IAM5 to notify CDK-NAG that 
    // This wildcard permission comes from AWS Managed Step Function\'s auto generated policies for step function on fly so cannot be replaced
    NagSuppressions.addResourceSuppressions(
      mapEventBridgeProcess,
      [
        { id: 'AwsSolutions-IAM5', reason: 'This wildcard permission comes from AWS Managed Step Function\'s auto generated policies for step function on fly so cannot be replaced' }
      ],
      true
    );
  }
}
