package main

import (
        "fmt"
        "encoding/json"
        "os"
        "log"
)

type Request struct {
        CaseId string `json:"caseId"`
}

type RequestSlot struct {
        Requests []Request `json:"requests"`
}

type RequestMessage struct {
        RequestId string `json:"requestId"`
        RequestSlots []RequestSlot `json:"requestSlots"`
}

func main() {
        targets := []int{1, 5, 10, 20, 40, 100, 200, 500, 700, 1000}
        limit := 40

        for _,target := range targets {
                // Find the x slots (num of arrays)
                slot := target / limit

                // Remaining divdend will go to a new slot
                if (target % limit) > 0 {
                        slot++
                }

                requestSlots := make([]RequestSlot, 0)

                counter := 0; 

                for targetSlot := 0; targetSlot < slot; targetSlot++ {
                        requests := make([]Request, 0)
                        requestSlot := RequestSlot{requests}
                        // Inject current slot into slot array
                        requestSlots = append(requestSlots, requestSlot)
                
                        // Get this slot limit
                        slotatarget :=  (targetSlot + 1) *  limit

                        // If exceed the total target, then will be final target
                        if slotatarget > target {
                                slotatarget = target
                        }

                        // Loop through all numbers for current slot
                        for ; counter < slotatarget; counter++ {
                                requestSlots[targetSlot].Requests = append(requestSlots[targetSlot].Requests, Request{fmt.Sprintf("%d", counter)})
                        }
                }



                m := RequestMessage{"123456", requestSlots}

                b, _ := json.Marshal(m)

                fmt.Println("")
                fmt.Println(fmt.Sprintf("Sample Dataset for %d cases:", target))
                fmt.Println(string(b))

		err := os.WriteFile(fmt.Sprintf("dataset_%d.json", target), []byte(string(b)), 0644)
		if err != nil {
				log.Fatal(err)
		}
        }
}