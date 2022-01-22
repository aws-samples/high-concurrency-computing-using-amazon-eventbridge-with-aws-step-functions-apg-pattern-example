import json
import time
import os
import boto3
import datetime
from botocore.exceptions import ClientError

# # step-fn-activity
client = boto3.client('stepfunctions')
    
def lambda_handler(event, context):
    
    case_Id = event["detail"]["request"]["caseId"]
    
    start = datetime.datetime.now()
    time.sleep(5)
    end = datetime.datetime.now()
    delta = end - start
        
    return_obj = event["detail"]
        
    return_obj["state"] = "processed in {} seconds".format(delta.total_seconds())
        
    eventbridge_client = boto3.client('events')
    response = eventbridge_client.put_events(
        Entries=[
            {
                'Source': os.getenv('EVENTBUS_SOURCE'),
                'Resources': [
                    os.getenv('EVENTBUS_ARN'),
                ],
                'DetailType': os.getenv('EVENTBUS_DETAILTYPE'),
                'Detail': json.dumps(return_obj),
                'EventBusName': os.getenv('EVENTBUS_NAME')
            },
        ]
    )
        
    return {}
