import * as cdk from 'aws-cdk-lib';
import lambda = require('aws-cdk-lib/aws-lambda');
import sfn = require('aws-cdk-lib/aws-stepfunctions');
import sfnTasks = require('aws-cdk-lib/aws-stepfunctions-tasks');
import logs = require('aws-cdk-lib/aws-logs');
import iam = require('aws-cdk-lib/aws-iam');
import { Duration } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';

export class StepFunctionMapIteratorStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * Lambda
     * 
     * Computing Lambda used to simulate calculation, will actually sleep for 5 sec
     * And push a new event to notify this calculation is completed
     */

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
     * Processing Step function
     * 
     */

    /**
     * Step Function Task
     * 
     * invokeComputationTask - Invoke the computing lambda with one calculation request with request Id
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-readme.html
     * 
    */
    const invokeComputationTask = new sfnTasks.LambdaInvoke(this, 'InvokeComputationTask', {
      lambdaFunction: computingLambda,
      inputPath: '$',
      outputPath: '$.Payload'
    });

    /**
     * Step Function Task
     * 
     * pushAllItemsToLambdaMap - Map iterator to map through all computing requests and invoke invokeComputationTask
     * 
     * From https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-readme.html
     *
    */
    const pushAllItemsToLambdaMap = new sfn.Map(this, 'PushAllItemsToLambdaMap', {
      inputPath: '$',
      itemsPath: '$.requests',
      resultPath: '$.processedItems',
      parameters: {
        requestId: sfn.JsonPath.stringAt('$.requestId'),
        request: sfn.JsonPath.stringAt('$$.Map.Item.Value')
      },
    }).iterator(invokeComputationTask);

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

    // Chain the next action after all map completed to invoke summary (as indication of next step)
    pushAllItemsToLambdaMap.next(invokeSummaryTask);

    /**
 * CloudWatch log group for increment Step Function
 * Will capture all logs from increment
 */
    const processLogGroup = new logs.LogGroup(this, 'ProcessLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY     // Clean up the log with stack
    });


    /**
     * Step Function
     * 
     * processSFN Step function for processing trigger to preform following
     * pushAllItemsToLambdaMap - Map iterator to map through incoming items concurrently
     *    invokeComputationTask - Push input item into target event bus
     * invokeSummaryTask - After all map iterator items push through, proceed to next step
     */
    const processSFN = new sfn.StateMachine(this, 'Process', {
      definition: pushAllItemsToLambdaMap,
      tracingEnabled: true,                          // Enable X-Ray
      logs: {
        destination: processLogGroup,          // Enable full logs to cloudwatch log group
        level: sfn.LogLevel.ALL,
      },
    });

    // Grant computing lambda invoke previliege to process step function
    computingLambda.grantInvoke(processSFN);
    // Grant summary lambda invoke previliege to process step function
    summaryLambda.grantInvoke(processSFN);

        // Enable adding suppressions to AwsSolutions-IAM5 to notify CDK-NAG that 
    // This wildcard permission comes from AWS Managed Step Function\'s auto generated policies for step function on fly so cannot be replaced
    NagSuppressions.addResourceSuppressions(
      processSFN,
      [
        { id: 'AwsSolutions-IAM5', reason: 'This wildcard permission comes from AWS Managed Step Function\'s auto generated policies for step function on fly so cannot be replaced' }
      ],
      true
    );
  }
}
