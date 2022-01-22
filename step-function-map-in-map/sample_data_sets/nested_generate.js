#!/usr/bin/env node

'use strict';

const fs = require('fs');
const util = require('util');

class Request {
    constructor(caseId) {
        this.caseId = caseId;
    }
}

class RequestSlot {
    constructor(requests) {
        this.requests = requests;
    }
}

class RequestMessage {
    constructor(requestId, requestSlots) {
        this.requestId = requestId;
        this.requestSlots = requestSlots;
    }
}

function main() {
    var targets = [1, 5, 10, 20, 40, 100, 200, 500, 700, 1000];
    var limit = 40;

    targets.forEach(function (target) {

        // Find the x slots (num of arrays)
        // Need to use integer to not get decimal
        var slot = parseInt(target / limit);

        // Remaining divdend will go to a new slot
        if ((target % limit) > 0) {
            slot++
        }

        var requestSlots = [];

        var counter = 0;


        for (var targetSlot = 0; targetSlot < slot; targetSlot++) {
            var requests = []
            var requestSlot = new RequestSlot(requests);

            // Inject current slot into slot array
            requestSlots.push(requestSlot);

            // Get this slot limit
            var slotatarget = (targetSlot + 1) * limit;

            // If exceed the total target, then will be final target
            if (slotatarget > target) {
                slotatarget = target
            }

            // Loop through all numbers for current slot
            while (counter < slotatarget) {
                requestSlots[targetSlot].requests.push(new Request(util.format("%d", counter)));
                counter++
            }
        }

        var requestMessage = new RequestMessage('123456', requestSlots);

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