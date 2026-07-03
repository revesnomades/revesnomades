$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$files = Get-ChildItem "c:\Users\mlautery\.antigravity\revesnomades\*.html"
foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $c = [System.Text.Encoding]::UTF8.GetString($bytes)
    
    # Clean up any corrupted encoding or old links in legal div
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '(\s*<a[^>]*>FAQ</a>\s*(?:·|Â·|\u00B7)?\s*)?<a[^>]*mentions-legales\.html[^>]*>[^<]*</a>\s*(?:·|Â·|\u00B7)?\s*<a[^>]*politique-confidentialite\.html[^>]*>[^<]*</a>', '<a href="/faq.html">FAQ</a> · <a href="/mentions-legales.html">Mentions légales</a> · <a href="/politique-confidentialite.html">Politique de confidentialité</a>')
    
    # Fix any residual Â·
    $c = $c.Replace('Â·', '·').Replace('lÃ©gales', 'légales').Replace('confidentialitÃ©', 'confidentialité')
    
    $outBytes = $utf8NoBom.GetBytes($c)
    [System.IO.File]::WriteAllBytes($f.FullName, $outBytes)
    Write-Host "Fixed encoding and links in $($f.Name)"
}
Write-Host "All footers cleanly fixed with UTF-8 No BOM!"
