#!/usr/bin/env node

'use strict';

const fs = require('fs');
const util = require('util');

class Request {
    constructor(caseId) {
        this.caseId = caseId;
    }
}

class RequestMessage {
    constructor(requestId, requests, length) {
        this.requestId = requestId;
        this.requests = requests;
        this.length = length;
    }
}

function main() {
    var targets = [1, 5, 10, 20, 40, 100, 200, 500, 700, 1000];

    targets.forEach(function(target) {
            var requests = []
            for(var i = 0; i < target; i++) {
                    requests.push(new Request(util.format('%d', i)));
            }

            var requestMessage = new RequestMessage('123456', requests, (util.format('%d', requests.length)));

            var content = JSON.stringify(requestMessage);

            console.log("");
            console.log(util.format("Sample Dataset for %d cases:", target));
            console.log(content);

           try {
            fs.writeFileSync(util.format('dataset_%d.json', target), content);
            //file written successfully
          } catch (err) {
            console.error(err)
          }
    });
}

main();