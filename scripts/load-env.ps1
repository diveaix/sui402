param(
  [string]$Path = ".env.testnet-rehearsal"
)

if (!(Test-Path -LiteralPath $Path)) {
  throw "Environment file not found: $Path"
}

$envFile = Resolve-Path -LiteralPath $Path
$envDirectory = Split-Path -Parent $envFile

Get-Content -LiteralPath $Path | ForEach-Object {
  $line = $_.Trim()
  if ($line.Length -eq 0 -or $line.StartsWith("#")) {
    return
  }

  $name, $value = $line -split "=", 2
  if (!$name) {
    return
  }

  if ($null -eq $value) {
    $value = ""
  }

  $key = $name.Trim()
  $trimmedValue = $value.Trim()
  if ($trimmedValue.Length -eq 0) {
    Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
    return
  }

  if ($key -eq "SUI402_CONSOLE_FILE_STORE_PATH" -and ![System.IO.Path]::IsPathRooted($trimmedValue)) {
    $trimmedValue = [System.IO.Path]::GetFullPath((Join-Path $envDirectory $trimmedValue))
  }

  Set-Item -Path "Env:$key" -Value $trimmedValue
}

Write-Host "Loaded environment from $Path"
