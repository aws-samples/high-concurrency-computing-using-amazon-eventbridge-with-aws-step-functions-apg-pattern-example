import json
import time
import os
import boto3
import datetime
from botocore.exceptions import ClientError

# # step-fn-activity
client = boto3.client('stepfunctions')
    
def lambda_handler(event, context):
    start = datetime.datetime.now()
    time.sleep(5)
    end = datetime.datetime.now()
    delta = end - start

    return_obj = event['detail']['payload']["request"]
    
    return_obj["state"] = "processed in {} seconds".format(delta.total_seconds())

    client.send_task_success(taskToken=event['detail']['taskToken'], output=json.dumps( return_obj))

    return {}
