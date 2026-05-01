[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$body = '{"email":"test@example.com","password":"testpassword"}'

# Test the exact endpoint the frontend uses
$response = Invoke-RestMethod -Uri 'https://revluma.onrender.com/api/session/login' -Method Post -Body $body -ContentType 'application/json'
$response | ConvertTo-Json

Write-Host ""
Write-Host "Testing /auth/register endpoint..."

$body2 = @{
    email = "frontendtest@example.com"
    password = "SecurePass123!"
    firstName = "Test"
    lastName = "User"
} | ConvertTo-Json

$response2 = Invoke-RestMethod -Uri 'https://revluma.onrender.com/api/auth/register' -Method Post -Body $body2 -ContentType 'application/json'
$response2 | ConvertTo-Json
