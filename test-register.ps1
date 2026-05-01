[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = @{
    email = "newuser$(Get-Random)@example.com"
    password = "SecurePass123!"
    firstName = "Test"
    lastName = "User"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri 'https://revluma.onrender.com/api/auth/register' -Method Post -Body $body -ContentType 'application/json'
$response | ConvertTo-Json
