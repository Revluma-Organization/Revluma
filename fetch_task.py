import urllib.request
import json
import urllib.parse

api_key = 'pk_106786773_AHLIF1SBBYDG5STV4RBJ36GI6BZNFVZN'
req = urllib.request.Request('https://api.clickup.com/api/v2/team', headers={'Authorization': api_key})
try:
    with urllib.request.urlopen(req) as response:
        teams = json.loads(response.read().decode())['teams']
        for team in teams:
            team_id = team['id']
            url = f'https://api.clickup.com/api/v2/team/{team_id}/task?include_closed=true'
            req_tasks = urllib.request.Request(url, headers={'Authorization': api_key})
            try:
                with urllib.request.urlopen(req_tasks) as resp_tasks:
                    tasks = json.loads(resp_tasks.read().decode()).get('tasks', [])
                    for t in tasks:
                        if 'Cart Recovery & Customers Pages Shell' in t['name']:
                            print(f"Task found: {t['name']}")
                            print(t['description'])
            except Exception as e:
                pass
except Exception as e:
    print(f"Error: {e}")
