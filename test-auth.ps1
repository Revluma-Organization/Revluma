[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = '{"email":"test@example.com","password":"testpassword123"}'
$response = Invoke-RestMethod -Uri 'https://revluma.onrender.com/api/session/login' -Method Post -Body $body -ContentType 'application/json'
$response | ConvertTo-Json
