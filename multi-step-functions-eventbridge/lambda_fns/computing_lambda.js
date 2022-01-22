'use strict';

// Prepare client to be able to capture SDK 
// https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-nodejs-awssdkclients.html
const awsxray = require('aws-xray-sdk-core')

// Configure the context missing strategy to do nothing
awsxray.setContextMissingStrategy(() => {});

const aws = awsxray.captureAWS(require('aws-sdk'));
const util = require('util');

const delay = time => new Promise(resolve => setTimeout(resolve, time));

exports.lambda_handler = async (event, context, callback) => {

  const eventbridge = new aws.EventBridge();

  // Declare a segment for Xray base on request and case Id to trace
  //{
  //  "request": {
  //    "caseId": "0"
  //  },
  //  "requestId": "123456"
  //}
  const calculationSubsegment = awsxray.getSegment().addNewSubsegment('computing');
  calculationSubsegment.addAnnotation('requestId', event.detail.request.caseId);
  calculationSubsegment.addAnnotation('caseId', event.detail.requestId);

  const start = Date.now();

  // Sleep for 5 seconds to simulate computation
  await delay(5000);

  const end = Date.now();
  const delta = end - start;

  // Close the computing calculation segment calculation
  calculationSubsegment.close();

  // Modify original event to add state
  var returnObj = event.detail;
  returnObj.state = util.format('processed in %s milliseconds', delta);

  var params = {
    Entries: [ /* required */
      {
        Detail: JSON.stringify(returnObj),
        DetailType: process.env.EVENTBUS_DETAILTYPE,
        EventBusName: process.env.EVENTBUS_NAME,
        Time: new Date,
        Resources: [
          process.env.EVENTBUS_ARN
          /* more items */
        ],
        Source: process.env.EVENTBUS_SOURCE
      }
      /* more items */
    ]
  };


  const result = await eventbridge.putEvents(params).promise();

  // Can parse result to do other error handling logic
  if (result.FailedEntryCount != 0) {
    // Right now just did basic error print out
    console.log(result);
  }

};