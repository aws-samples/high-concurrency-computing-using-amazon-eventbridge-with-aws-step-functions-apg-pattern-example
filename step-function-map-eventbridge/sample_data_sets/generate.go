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

type RequestMessage struct {
        RequestId string `json:"requestId"`
        Requests []Request `json:"requests"`
        Length string `json:"length"`
}

func main() {
        targets := []int{1, 5, 10, 20, 40, 100, 200, 500, 700, 1000}

        for _,target := range targets {
                requests := make([]Request, 0)
                for i := 0; i < target; i++ {
                        requests = append(requests, Request{fmt.Sprintf("%d", i)})
                }

                m := RequestMessage{"123456", requests, fmt.Sprintf("%d", len(requests))}

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