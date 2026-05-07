param(
    [string]$PrinterName,
    [string]$FilePath,
    [int]$TimeoutSeconds = 15
)

$bytes = [System.IO.File]::ReadAllBytes($FilePath)

$printerObj = Get-Printer -Name $PrinterName -ErrorAction Stop
$portName = $printerObj.PortName
if ($printerObj.PrinterStatus -match 'Error|Offline|PaperOut|NotAvailable|NoToner|DoorOpen') {
    throw "Printer '$PrinterName' is not ready: status=$($printerObj.PrinterStatus), jobs=$($printerObj.JobCount), port=$portName"
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinter {
    [DllImport("winspool.drv", CharSet=CharSet.Ansi, SetLastError=true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet=CharSet.Ansi, SetLastError=true)]
    public static extern int StartDocPrinter(IntPtr hPrinter, int Level, ref DOCINFO pDocInfo);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public struct DOCINFO {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
}
"@

$hPrinter = [IntPtr]::Zero
if (-not [RawPrinter]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "OpenPrinter failed for '$PrinterName' (Win32=$err)"
}

$docInfo = New-Object RawPrinter+DOCINFO
$docInfo.pDocName   = "pastita-order"
$docInfo.pOutputFile = $null
$docInfo.pDataType  = "RAW"

$docStarted = $false
$pageStarted = $false

try {
    $docId = [RawPrinter]::StartDocPrinter($hPrinter, 1, [ref]$docInfo)
    if ($docId -le 0) {
        $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "StartDocPrinter failed for '$PrinterName' (Win32=$err)"
    }
    $docStarted = $true

    if (-not [RawPrinter]::StartPagePrinter($hPrinter)) {
        $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "StartPagePrinter failed for '$PrinterName' (Win32=$err)"
    }
    $pageStarted = $true

    $written = 0
    if (-not [RawPrinter]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written)) {
        $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "WritePrinter failed for '$PrinterName' (Win32=$err, written=$written/$($bytes.Length))"
    }

    if ($written -ne $bytes.Length) {
        throw "WritePrinter wrote only $written of $($bytes.Length) bytes to '$PrinterName'"
    }
}
finally {
    if ($pageStarted) {
        [RawPrinter]::EndPagePrinter($hPrinter) | Out-Null
    }
    if ($docStarted) {
        [RawPrinter]::EndDocPrinter($hPrinter) | Out-Null
    }
    [RawPrinter]::ClosePrinter($hPrinter) | Out-Null
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    $printerObj = Get-Printer -Name $PrinterName -ErrorAction Stop
    if ($printerObj.PrinterStatus -match 'Error|Offline|PaperOut|NotAvailable|NoToner|DoorOpen') {
        throw "Printer '$PrinterName' entered bad status after submit: status=$($printerObj.PrinterStatus), jobs=$($printerObj.JobCount), port=$portName"
    }

    $job = Get-PrintJob -PrinterName $PrinterName -ID $docId -ErrorAction SilentlyContinue
    if (-not $job) {
        Write-Output "Print job $docId accepted and left queue for '$PrinterName' ($written/$($bytes.Length) bytes)."
        exit 0
    }

    if ($job.JobStatus -match 'Error|Offline|PaperOut|Blocked|UserIntervention') {
        throw "Print job $docId failed/stalled: status=$($job.JobStatus), document=$($job.DocumentName)"
    }

    Start-Sleep -Milliseconds 500
}

$stuckJob = Get-PrintJob -PrinterName $PrinterName -ID $docId -ErrorAction SilentlyContinue
if ($stuckJob) {
    throw "Print job $docId stayed in queue after ${TimeoutSeconds}s: status=$($stuckJob.JobStatus), document=$($stuckJob.DocumentName)"
}
