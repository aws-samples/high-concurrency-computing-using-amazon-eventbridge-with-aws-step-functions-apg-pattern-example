import * as cdk from 'aws-cdk-lib';
import lambda = require('aws-cdk-lib/aws-lambda');
import dynamodb = require('aws-cdk-lib/aws-dynamodb');
import sfn = require('aws-cdk-lib/aws-stepfunctions');
import sfnTasks = require('aws-cdk-lib/aws-stepfunctions-tasks');
import logs = require('aws-cdk-lib/aws-logs');
import events = require('aws-cdk-lib/aws-events');
import sqs = require('aws-cdk-lib/aws-sqs');
import kms = require('aws-cdk-lib/aws-kms');
import iam = require('aws-cdk-lib/aws-iam');
import events_targets = require('aws-cdk-lib/aws-events-targets');
import { RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';

export class MultiStepFunctionsEventbridgeStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    // KMS Key for bucket encrpytion
    const kmsKey = new kms.Key(this, 'multiStepfunctionseventbridgestack-encryption-key', {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY,       // Auto destroy if removed from stack
      pendingWindow: Duration.days(7)             // Delete after 7 day once delete is triggered
    });

    /**
     * DynamoDB Table
     * 
     * DynamoDB to use as an incremental to track required calculations in one request
     * 
     * requestId - Track the id of the request
     * requestId
     */

    const requestTable = new dynamodb.Table(this, 'request', {
      partitionKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,                             // Enable encrpytion with customer managed key above
      pointInTimeRecovery: true,                         // Enable point in time
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
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
     * And push a new event to notify this calculation is completed
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
      tracing: lambda.Tracing.ACTIVE,               // Enable xray tracing to complete tracing from step function to xray
      environment: {
        EVENTBUS_NAME: computingBus.eventBusName,
        EVENTBUS_ARN: computingBus.eventBusArn,
        EVENTBUS_SOURCE: computingSourceName,
        EVENTBUS_DETAILTYPE: computingDetailTypeName
      }
    });

    // Provide computingLambda permission to put events on our EventBridge
    computingBus.grantPutEventsTo(computingLambda);

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
      tracing: lambda.Tracing.ACTIVE,               // Enable xray tracing to complete tracing from step function to xray
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
     * setupTableTask - Analyze to find number of calculations (this is simplify to just retrieve a field, but can be through lambda and other forms), 
     * and update dynamoDB request table with this new request
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-tasks-readme.html#updateitem
     * 
    */
    const setupTableTask = new sfnTasks.DynamoUpdateItem(this, 'SetupTableRecord', {
      key: {
        requestId: sfnTasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.requestId'))
      },
      expressionAttributeNames: {
        '#counter': 'counter',
        '#target': 'target'
      },
      expressionAttributeValues: {
        ':initial': sfnTasks.DynamoAttributeValue.fromNumber(0),
        ':target': sfnTasks.DynamoAttributeValue.numberFromString(sfn.JsonPath.stringAt('$.length')),
      },
      updateExpression: 'SET #counter = :initial, #target = :target',
      table: requestTable,
      resultPath: sfn.JsonPath.DISCARD
    });

    /**
     * Step Function Task
     * 
     * pushEventTask - Push input item into target event bus
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-tasks-readme.html#put-events
     * 
    */
    const pushEventTask = new sfnTasks.EventBridgePutEvents(this, 'PushEvent', {
      entries: [{
        detail: sfn.TaskInput.fromJsonPathAt('$'),
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
    const PushAllItemsToEventBridge = new sfn.Map(this, 'PushAllItemsToEventBridge', {
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
     * CloudWatch log group for PreProcess Step Function
     * Will capture all logs from preProcess
     */
    const preProcessSFNLogGroup = new logs.LogGroup(this, 'PreProcessSFNLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY     // Clean up the log with stack
    });

    /**
     * Step Function
     * 
     * PreProcess Step function for Pre-processing trigger to preform following
     * SetupTableRecord - Analyze to find number of calculations (this is simplify to just retrieve a field, but can be through lambda and other forms), and update dynamoDB request table with this new request
     * TaskPushAllItemsToEventBridge - Map iterator to map through incoming items concurrently
     *    TaskPushEvent - Push input item into target event bus
     */
    const preProcessSFN = new sfn.StateMachine(this, 'PreProcess', {
      definition: setupTableTask.next(PushAllItemsToEventBridge),
      tracingEnabled: true,                          // Enable X-Ray
      logs: {
        destination: preProcessSFNLogGroup,          // Enable full logs to cloudwatch log group
        level: sfn.LogLevel.ALL,
      },
    });

    // Assign the write permission to the preProcess StepFunction to access log group
    preProcessSFNLogGroup.grantWrite(preProcessSFN);

    // Assign the preProcess StepFunction to read and write data from the requestTable
    requestTable.grantReadWriteData(preProcessSFN);

    // Enable adding suppressions to AwsSolutions-IAM5 to notify CDK-NAG that 
    // This wildcard permission comes from AWS Managed Step Function\'s auto generated policies for step function on fly so cannot be replaced
    NagSuppressions.addResourceSuppressions(
      preProcessSFN,
      [
        { id: 'AwsSolutions-IAM5', reason: 'This wildcard permission comes from AWS Managed Step Function\'s auto generated policies for step function on fly so cannot be replaced' }
      ],
      true
    );

    /**
      * 
      * Step Function
      * 
      * IncrementProcess Step function
      * 
      */

    /**
     * Step Function Task
     * 
     * incrementTableRecordTask - Incremental DynamoDB request table with request ID's row's counter field
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-tasks-readme.html#updateitem
     * 
    */
    const incrementTableRecordTask = new sfnTasks.DynamoUpdateItem(this, 'IncrementTableRecord', {
      key: {
        requestId: sfnTasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.requestId'))
      },
      expressionAttributeValues: {
        ':increment': sfnTasks.DynamoAttributeValue.fromNumber(1)
      },
      expressionAttributeNames: {
        '#counter': 'counter'
      },
      updateExpression: 'ADD #counter :increment',
      table: requestTable,
      returnValues: sfnTasks.DynamoReturnValues.ALL_NEW,
      outputPath: sfn.JsonPath.stringAt('$.Attributes')
    });

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
     * Step Function Task
     * 
     * DefaultEndTask - Empty task to end choice
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-readme.html
     * 
    */
    const defaultEndTask = new sfn.Pass(this, 'DefaultEndTask');

    /**
     * Step Function Task
     * 
     * CheckIfComplete - Check if result from DynamoDB result record (after update) whatever the counter matches the target
     * If matches, it means all calculations completed, proceed to next step by invoking summary lambda
     * If not match, it is not redy to invoke next step yet, so fall to a default end task to end this execution
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-readme.html
     * 
    */
    const checkIfCompleteTask = new sfn.Choice(this, 'CheckIfComplete',);
    checkIfCompleteTask.when(sfn.Condition.stringEqualsJsonPath('$.counter.N', '$.target.N'), invokeSummaryTask);
    checkIfCompleteTask.otherwise(defaultEndTask);

    /**
     * CloudWatch log group for increment Step Function
     * Will capture all logs from increment
     */
    const incrementSFNLogGroup = new logs.LogGroup(this, 'IncrementSFNLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY     // Clean up the log with stack
    });


    /**
     * Step Function
     * 
     * IncrementProcess Step function for Pre-processing trigger to preform following
     * incrementTableRecordTask - Incremental DynamoDB request table with request ID's row's counter field
     * checkIfCompleteTask - Choice to check whatever target and counter matches, 
     *  If matches, it means all calculations completed, proceed to next step by invoking summary lambda
     *  If not match, it is not redy to invoke next step yet, so fall to a default end task to end this execution
     * invokeSummaryTask - Task only got called if all calculations done, and invoke lambda to signify next step to begin
     * 
     */
    const incrementSFN = new sfn.StateMachine(this, 'IncrementProcess', {
      definition: incrementTableRecordTask.next(checkIfCompleteTask),
      tracingEnabled: true,                          // Enable X-Ray
      logs: {
        destination: incrementSFNLogGroup,          // Enable full logs to cloudwatch log group
        level: sfn.LogLevel.ALL,
      },
    });

    // Assign incremental step function to able to write to log group
    incrementSFNLogGroup.grantWrite(incrementSFN);

    // Assign dynamoDB for step function to update the counter table
    requestTable.grantReadWriteData(incrementSFN);

    // Grant permission for incrementSFN to called summary Lambda
    summaryLambda.grantInvoke(incrementSFN);

    // Enable adding suppressions to AwsSolutions-IAM5 to notify CDK-NAG that 
    // This wildcard permission comes from AWS Managed Step Function\'s auto generated policies for step function on fly so cannot be replaced
    NagSuppressions.addResourceSuppressions(
      incrementSFN,
      [
        { id: 'AwsSolutions-IAM5', reason: 'This wildcard permission comes from AWS Managed Step Function\'s auto generated policies for step function on fly so cannot be replaced' }
      ],
      true
    );

    // Create event bus rule to invoke summary step function
    // From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-events-targets-readme.html
    const invokeIncSFNRule = new events.Rule(this, 'InvokeIncSFNRule', {
      eventBus: computingBus,
      eventPattern: {
        source: [computingSourceName],
      },
    });

    /** 
     * Target Transformation
     * 
     * From lambda to event bridge, it is like following in event bridge
     * 
     * 
     *  {
     *  ...
          "detail": {
            "request": {
              "caseId": "1"
            },
            "state": "<complete message>"
            "requestId": "123456"
          }
        }
     *
     * the event bridge will then transform the message to only send following to step function
     * {
          "request": {
            "caseId": "1"
          },
          "state": "<complete message>"
          "requestId": "123456"
        }
     */
    invokeIncSFNRule.addTarget(new events_targets.SfnStateMachine(incrementSFN, {
      deadLetterQueue: computingBusDLQ,                // Optional: add a dead letter queue
      retryAttempts: 2,                                // Optional: set the max number of retry attempts
      input: RuleTargetInput.fromEventPath("$.detail") // Require, as the incremental summary only expect a schema object, instead of whole event, if modify here, need to also modify incremental step function
    }));
  }
}
