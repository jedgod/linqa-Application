import http from "k6/http";
import { check, sleep } from "k6";

export const options={
  scenarios:{
    discovery:{
      executor:"ramping-vus",
      startVUs:0,
      stages:[
        {duration:"2m",target:50},
        {duration:"5m",target:200},
        {duration:"2m",target:0}
      ]
    }
  },
  thresholds:{
    http_req_failed:["rate<0.01"],
    http_req_duration:["p(95)<350","p(99)<800"]
  }
};

const BASE=__ENV.BASE_URL;
const TOKEN=__ENV.TEST_TOKEN;

export default function(){
  const r=http.post(
    `${BASE}/v1/countrylinqa/advanced/people/search`,
    JSON.stringify({filters:{verifiedOnly:true},limit:30}),
    {headers:{Authorization:`Bearer ${TOKEN}`,"Content-Type":"application/json"}}
  );
  check(r,{"status 200":x=>x.status===200});
  sleep(1);
}
