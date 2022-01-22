import json
import time
import os
import boto3
import datetime
from botocore.exceptions import ClientError

# # step-fn-activity
client = boto3.client('stepfunctions')
    
def lambda_handler(event, context):
    
    case_Id = event["request"]["caseId"]
    
    tick = 0
    
    start = datetime.datetime.now()
    time.sleep(5)
    end = datetime.datetime.now()
    delta = end - start

    return_obj = event["request"]
    
    return_obj["state"] = "processed in {} seconds".format(delta.total_seconds())

    return return_obj
