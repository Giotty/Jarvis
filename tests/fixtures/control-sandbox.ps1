# Run from the verified repository root. Creates a disposable GUI, not a shell UI.
$jarvisFixtureSource = Join-Path $PWD 'tests\fixtures\control-sandbox.cs'
$jarvisFixtureBinary = Join-Path $PWD "tmp\JARVISControlSandbox-$PID.exe"
if (-not (Test-Path -LiteralPath $jarvisFixtureSource)) { throw 'Run from the JARVIS repository root.' }
Add-Type -Path $jarvisFixtureSource -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $jarvisFixtureBinary -OutputType WindowsApplication
Start-Process -FilePath $jarvisFixtureBinary -WindowStyle Hidden
