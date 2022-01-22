'use strict';

// Prepare client to be able to capture SDK 
// https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-nodejs-awssdkclients.html
const awsxray = require('aws-xray-sdk-core')

// Configure the context missing strategy to do nothing
awsxray.setContextMissingStrategy(() => { });

const aws = awsxray.captureAWS(require('aws-sdk'));
const util = require('util');

const delay = time => new Promise(resolve => setTimeout(resolve, time));

exports.lambda_handler = async (event, context, callback) => {
    // Declare a segment for Xray base on request and case Id to trace
    //{
    //  "request": {
    //    "caseId": "0"
    //  },
    //  "requestId": "123456"
    //}
    const calculationSubsegment = awsxray.getSegment().addNewSubsegment('computing');
    calculationSubsegment.addAnnotation('requestId', event.request.caseId);
    calculationSubsegment.addAnnotation('caseId', event.requestId);

    const start = Date.now();

    // Sleep for 5 seconds to simulate computation
    await delay(5000);

    const end = Date.now();
    const delta = end - start

    // Close the computing calculation segment calculation
    calculationSubsegment.close();

    // Modify original event to add state
    var returnObj = {
        request: event.request,
        requestId: event.requestId,
        state: util.format('processed in %s milliseconds', delta)
    };

    return returnObj;
};