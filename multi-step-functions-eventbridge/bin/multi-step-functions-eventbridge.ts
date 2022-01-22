#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MultiStepFunctionsEventbridgeStack } from '../lib/multi-step-functions-eventbridge-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();
new MultiStepFunctionsEventbridgeStack(app, 'MultiStepFunctionsEventbridgeStack');
// Simple rule informational messages
// Additional explanations on the purpose of triggered rules
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));