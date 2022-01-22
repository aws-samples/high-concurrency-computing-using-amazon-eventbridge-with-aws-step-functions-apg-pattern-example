'use strict';

// Prepare client to be able to capture SDK 
// https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-nodejs-awssdkclients.html
const awsxray = require('aws-xray-sdk-core')

// Configure the context missing strategy to do nothing
awsxray.setContextMissingStrategy(() => { });

const aws = awsxray.captureAWS(require('aws-sdk'));
const util = require('util');

exports.lambda_handler = (event, context, callback) => {
    // Dummy function to present next step after concurrency computing all completes
    console.log(JSON.stringify(event));
};