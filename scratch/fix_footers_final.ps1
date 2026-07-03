$ErrorActionPreference = "Stop"
$files = Get-ChildItem "c:\Users\mlautery\.antigravity\revesnomades\*.html"
foreach ($f in $files) {
    $c = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    
    # First remove any FAQ link
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '\s*<a[^>]*faq\.html[^>]*>[^<]*</a>\s*(?:·\s*)?', '')
    
    # Now replace mentions link with FAQ · Mentions
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '<a[^>]*mentions-legales\.html[^>]*>[^<]*</a>', '<a href="/faq.html">FAQ</a> · <a href="/mentions-legales.html">Mentions légales</a>')
    
    # And standardize politique link
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '<a[^>]*politique-confidentialite\.html[^>]*>[^<]*</a>', '<a href="/politique-confidentialite.html">Politique de confidentialité</a>')
    
    [System.IO.File]::WriteAllText($f.FullName, $c, [System.Text.Encoding]::UTF8)
    Write-Host "Processed $($f.Name)"
}
Write-Host "All footers updated with fallback encoding match!"
