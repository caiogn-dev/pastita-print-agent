param(
    [string]$PrinterName,
    [string]$FilePath
)

$bytes = [System.IO.File]::ReadAllBytes($FilePath)

$printerObj = Get-Printer -Name $PrinterName -ErrorAction Stop
$portName = $printerObj.PortName

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
[RawPrinter]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero) | Out-Null

$docInfo = New-Object RawPrinter+DOCINFO
$docInfo.pDocName   = "pastita-order"
$docInfo.pOutputFile = $null
$docInfo.pDataType  = "RAW"

[RawPrinter]::StartDocPrinter($hPrinter, 1, [ref]$docInfo) | Out-Null
[RawPrinter]::StartPagePrinter($hPrinter) | Out-Null

$written = 0
[RawPrinter]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written) | Out-Null

[RawPrinter]::EndPagePrinter($hPrinter) | Out-Null
[RawPrinter]::EndDocPrinter($hPrinter) | Out-Null
[RawPrinter]::ClosePrinter($hPrinter) | Out-Null
