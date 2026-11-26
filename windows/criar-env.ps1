# Cria o arquivo .env com as senhas do robô.
# As senhas ficam guardadas na sua pasta de usuário (robo-ofertas.env),
# então baixar uma versão nova do robô NÃO troca as senhas.
$ErrorActionPreference = 'Stop'
$projEnv  = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
$saved    = Join-Path $env:USERPROFILE 'robo-ofertas.env'
function Rnd($n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }

$vals = @{}
foreach ($f in @($saved, $projEnv)) {
  if (Test-Path $f) {
    foreach ($l in Get-Content $f) { if ($l -match '^\s*([A-Z_]+)=(.*)$' -and -not $vals[$matches[1]]) { $vals[$matches[1]] = $matches[2].Trim() } }
  }
}
if (-not $vals.PANEL_PASSWORD)    { $vals.PANEL_PASSWORD = Rnd 10 }
if (-not $vals.EVOLUTION_API_KEY) { $vals.EVOLUTION_API_KEY = Rnd 32 }

$text = "PANEL_PASSWORD=$($vals.PANEL_PASSWORD)`nEVOLUTION_API_KEY=$($vals.EVOLUTION_API_KEY)`nAUTHENTICATION_API_KEY=$($vals.EVOLUTION_API_KEY)`n"
$enc = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($saved, $text, $enc)
[System.IO.File]::WriteAllText($projEnv, $text, $enc)
