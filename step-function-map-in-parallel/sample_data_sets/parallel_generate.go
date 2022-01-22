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
        slot := 3
        
        for _,target := range targets {

                requestSlots := make([]RequestSlot, 0)

                for xi := 0; xi < slot; xi++ {
                        requests := make([]Request, 0)
                        requestSlot := RequestSlot{requests}
                        // Inject current slot into slot array
                        requestSlots = append(requestSlots, requestSlot)
                }

                // Loop through all numbers in target
                for counter := 0; counter < target; counter++ {
                        // Divide by slot and get reminder of result (to ensure not exceed slot count) to get into correct slot
                        targetSlotIndex := (counter / slot) % slot
                        requestSlots[targetSlotIndex].Requests = append(requestSlots[targetSlotIndex].Requests, Request{fmt.Sprintf("%d", counter)})
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