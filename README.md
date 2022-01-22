# High Concurrency Computing Using Amazon EventBridge with AWS Step Functions APG Pattern Example


[[_TOC_]]


## Important Note
THIS PERFORMANCE NUMBER IS NOT AIMING TO SHARE WITH CUSTOMER NOR REPRESENT FORMAL AWS PERFORMANCE INDICATOR, BUT RATHER EXPERIMENTS WITH DIFFERENT APPROACH FOR CERTAIN CUSTOMER USE CASE

## APG Pattern
This is example repo for the APG Pattern: High Concurrency Computing Using Amazon EventBridge with AWS Step Functions APG Pattern Example

## Overview
Enterprise customers are migrating/modernizing existing workloads to serverless architecture to enable scalability and reduce maintenance cost. One of workloads is a point - in - time batch processing with state machine monitor and audibility: one request triggers a step, the step processes through the request and schedule large number of concurrencies as needed, next step will be triggered once all concurrency processes completed, and entire system control in a state machine mechanism for process audit/monitoring.

One approaches toward this problem is to leverage AWS Step Function to govern the over process.

AWS Step Function provides state machine controls mechanism out of box (i.e. step definitions, chaining of multiple steps for form one large state, and retry logics). It also provides native integrations with frequent used AWS computing services (AWS Lambda/AWS ECS/AWS Batch) and HTTP request supports for other services.

This repo goes through some common approaches toward this workload with AWS Step Function with other AWS services and provides recommended architecture. It also discusses advantages/disadvantages of these different approaches.


## Customer Challenges
Customer is satisfied with how AWS Step Function simplified the overall state managements (out of box audit/retry/integration with computing AWS services) in serverless fashion. But they express challenges with following:

1. Performance when the workflow involved high concurrency computing (100+ to 1000+) steps with Step Function’s out of box concurrency step definition (Map Iterator or Parallel). 

At time of this written, there is an upper bound limit of 40 concurrency within the Map Iterator*. When input requests are higher than this number, Map Iterator step will process in batch of 40: for example, a 200 items request will be processed in 5 batch, each batch with 40 concurrency requests.

However, customer mentioned 40 requests are too small and want to increase the concurrency amount as much as possible. They did change the concurrency number in map iterator but these attempts still not achieved customer’s desired performance (customer expressed it is “multitude slower“ when compare to lower concurrency).

This article will explore through some common suggestions such as Map in Map (Map Iterator Step within Map Iterator Step), Parallel with Map (fixed amount of Map Iterator in a Parallel Step) and other approaches.

2. Explore and integrate different computation targets as needed while keep the AWS Step Function manageable

One popular computation serverless is AWS Lambda. But as customer build into each Lambda function to be much more efficiency to work around #1, they faced challenged in managing growing conditions within AWS Step Function: data type 1 goes to Lambda 1 up to data type N to Lambda N.

3. The overhead of adding other services if want to solve #1/#2

Customer is skeptical whatever there will be performance overhead of introducing other AWS services to solve #1/#2 and is why lean toward to solve everything within AWS Step Functions.


## Customer Requirements
1. One trigger request will result in large concurrency calculations in one step
2. All calculations must be done (confirm to finish calculations) before next step can be proceeded
3. Need to be as efficiency as possible
4. Current calculation is in Lambda, but also consider other approaches in future in case a single calculation (i.e. model calculation) exceeds Lambda maximum timeout
5. This entire flow need to be monitorable/auditable with retry logic/error handling


## Assumptions
- Computing lambda process can horizontal scale without bottleneck by data source
- Each computing lambda process is independent and not waiting for result from each other
- Need to adopt to a unknown growth data input


## Limitations 
- Patterns described in this comparison not suitable if record processing order must be guaranteed (i.e. the process must be record 1, record 2 and so on) as the goal is aiming to push higher concurrency rather than preserve order.
- It is acknowledged there are indeed efficient approaches such as build everything from scratches with EC2 and adjust toward this one specific use case, but this article will guide toward AWS Step Functions and other managed AWS services to fulfill customer’s requirements (i.e. serverless/fully managed services and out of box audit/monitor ability)
- In certain approaches, there will be overhead for small loads (for requests under 40 concurrency)


## Patterns
1. [Multi - Step Function with EventBridge (No Callback) [**RECOMMENDED**]](multi-step-functions-eventbridge)
2. [Map Iterator](step-function-map-iterator)
3. [Map Iterator within Map Iterator [**NOT RECOMMENDED**]](step-function-map-in-map)
4. [Map Iterator within Parallel [**NOT RECOMMENDED**]](step-function-map-in-parallel)
5. [Map Iterator with EventBridge (Callback)](step-function-map-eventbridge)


## Current recommended Pattern
[Multi - Step Function with EventBridge (No Callback Pattern)](multi-step-functions-eventbridge) will be the ideal choice base on below analyze

## Pattern Performance Comparison
Performance records can be found in [performance](performance) folder
![performance](images/performance_chart.png)

## Pattern Comparison Table
| Feature                  | [Option #1<br> Multiple Step Functions with EventBridge(No Callaback)](multi-step-functions-eventbridge) <br> **RECOMMEND** | [Option #2<br> Step Function Map Iterator](step-function-map-iterator) | [Options #3 Map Iterator within Map Iterator](step-function-map-in-map) <br> [Options #4 Map Iterator within Parallel](step-function-map-in-parallel) <br> **NOT RECOMMENDED** | [Options #5 <br> Map Iterator with Event Bridge (CallBack)](step-function-map-eventbridge)
| --- | --- | --- | --- | --- |
| Prerequistes | Place data into efficient short – term IO solution (i.e. AWS Elastic Cache) and only pass data ID within invocation (minimize data size flow within system during invocation) <br> Computing unit will read/write into efficient short – term IO solution base on passed in ID record |  Same | Same | Same | Same |
| Implementation steps     | Implement existing SQS with EventBridge as event bus -Implement trigger with AWS Step Functions to push to EventBridge, which invoke computing unit <br> Implement computing unit to push comp/fail status to EventBridge, which trigger another Post Step Function <br> Implement Post Step Function to audit incoming status and update global counter and proceed next step when ready* | Implement Step Function with Map Iterator to trigger computation | Implement a way to split the data into either: <br> - Data is split into map of map (with 40 items max in internal map) for map within map <br> - Data is split into fixed number of map (i.e. split the data into 3 array) for map within parallel <br> Implement Step Function with: <br> - For map within map, outer map iterator loops outer map, and pass the current item (contain that max 40 items map) to internal map iterator <br> - For map within parallel, implement map iterator with map iterator | Implement Step Function with Map Iterator to push invocation as event to EventBridge with callback token <br> Implement Calculation computing to use callback token to notify event bridge when it completes |
| Timelines | Slower to implement due to complex architecture <br> Scaled much better compare to other approaches on this table  | Faster to implement due to simple architecture <br> Not scale well compare to #1 due to 40 concurrency limit within Map Iterator*  | Complex to implement due to its complex data structure <br> Perform slow compare to all other options (with map within map being the slowest out of all 5 options) | Similar as #2 but less complex than #3/#4 |
| Risks | Complex compare (such as counter with lock) to other approaches on this table due to its distributed nature <br> Monitor and scale up account limits* <br> Have bottleneck for short lambda executions (have a limit of 40 events in a batch*) | It is not scale up as good as #1, which may eventually be bottleneck as concurrency load for one request increased in future | Complex data structure mutation <br> Harder to monitor (due to different performance behaviors during each run*) | Similar as #2 |
|Advantages | Utilize Step Function to get out of box monitor/retry logic/state machines <br> Utilize EventBridge to have a central router configuration with subscription approach* | Simplest out of all options <br> Easier to monitor <br> Less services involved <br> Still get benefit of Step Functions (audit of invocations/retry logic) <br> Out of box implementation for waiting for all invocations | Similar as #2<br> Some benefits of EventBridge as in #1 (subscription approach) | Similar as #2 <br> Some benefits of EventBridge as in #1 (subscription approach) |


## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

