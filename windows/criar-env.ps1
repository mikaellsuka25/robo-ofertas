# Cria (ou completa) o arquivo .env com senhas aleatórias
$ErrorActionPreference = 'Stop'
$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
function Rnd($n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }

$vals = @{}
if (Test-Path $envPath) {
  foreach ($l in Get-Content $envPath) { if ($l -match '^\s*([A-Z_]+)=(.*)$') { $vals[$matches[1]] = $matches[2].Trim() } }
}
if (-not $vals.PANEL_PASSWORD)    { $vals.PANEL_PASSWORD = Rnd 10 }
if (-not $vals.EVOLUTION_API_KEY) { $vals.EVOLUTION_API_KEY = Rnd 32 }
if (-not $vals.POSTGRES_PASSWORD) { $vals.POSTGRES_PASSWORD = Rnd 24 }

$lines = @(
  "PANEL_PASSWORD=$($vals.PANEL_PASSWORD)",
  "EVOLUTION_API_KEY=$($vals.EVOLUTION_API_KEY)",
  "AUTHENTICATION_API_KEY=$($vals.EVOLUTION_API_KEY)",
  "POSTGRES_PASSWORD=$($vals.POSTGRES_PASSWORD)",
  "DATABASE_CONNECTION_URI=postgresql://evolution:$($vals.POSTGRES_PASSWORD)@postgres:5432/evolution?schema=public"
)
[System.IO.File]::WriteAllText($envPath, ($lines -join "`n") + "`n", (New-Object System.Text.UTF8Encoding $false))
