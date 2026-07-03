$ErrorActionPreference = "Stop"
$files = Get-ChildItem "c:\Users\mlautery\.antigravity\revesnomades\*.html"
foreach ($f in $files) {
    $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    
    # Check if <a href="/faq.html">FAQ</a> is not already right before Mentions
    if ($content -notmatch '<a href="/faq\.html">FAQ</a>\s*·\s*<a href="/?mentions-legales\.html"') {
        # Replace mentions-legales.html link with FAQ · Mentions
        $newContent = [System.Text.RegularExpressions.Regex]::Replace($content, '<a\s+href="/?mentions-legales\.html"[^>]*>Mentions légales</a>', '<a href="/faq.html">FAQ</a> · <a href="/mentions-legales.html">Mentions légales</a>')
        if ($content -ne $newContent) {
            [System.IO.File]::WriteAllText($f.FullName, $newContent, [System.Text.Encoding]::UTF8)
            Write-Host "Updated legal line in $($f.Name)"
        }
    }
}
Write-Host "Done adding FAQ before Mentions."
