param([Parameter(Mandatory=$true)][string]$OutputRoot)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$voice=New-Object System.Speech.Synthesis.SpeechSynthesizer
$format=[System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(48000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$voice.Rate=-1
$voice.SetOutputToWaveFile((Join-Path $OutputRoot 'voice-a.wav'),$format)
$voice.Speak("Wait here. I'll return before sunrise.")
$voice.SetOutputToNull()
$voice.Rate=0
$voice.SetOutputToWaveFile((Join-Path $OutputRoot 'voice-b.wav'),$format)
$voice.Speak("Wait here. I'll return before sunrise.")
$voice.SetOutputToNull()
$voice.Dispose()

