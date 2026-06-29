$newSocialBlock = @"
          <a class="icon-btn light" href="https://instagram.com/amesnomades_retreat" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
            <svg class="icon" viewBox="0 0 24 24" fill="none">
              <path d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Z" stroke="currentColor" stroke-width="1.7"/>
              <path d="M12 16.2A4.2 4.2 0 1 0 12 7.8a4.2 4.2 0 0 0 0 8.4Z" stroke="currentColor" stroke-width="1.7"/>
              <path d="M17.6 6.4h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            </svg>
          </a>

          <a class="icon-btn light" href="https://www.facebook.com/share/1bLsFzNTCz/?mibextid=wwXIfr" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
            <svg class="icon" viewBox="0 0 24 24" fill="none">
              <path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v3H7v3h3v6h3v-6h3l1-3h-4v-3c0-.6.4-1 1-1Z" fill="currentColor"/>
            </svg>
          </a>

          <a class="icon-btn light" href="https://www.tiktok.com/@amesnomades_retreat" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
            <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.5 3v13.1c0 1.4-1.2 2.6-2.6 2.6s-2.6-1.2-2.6-2.6 1.2-2.6 2.6-2.6v-2.6a5.2 5.2 0 1 0 5.2 5.2V7.1a7.3 7.3 0 0 0 3.8 1.1V5.5A4.6 4.6 0 0 1 15 3h-2.5z"/>
            </svg>
          </a>
"@

# We need to target the block starting with `<a class="icon-btn light" href="https://instagram.com/amesnomades_retreat"`
# and ending at `</svg> \s* </a>` where the inner is facebook.

$pattern = '(?s)<a class="icon-btn light" href="https://instagram\.com/amesnomades_retreat".*?<a class="icon-btn light" href="https://facebook\.com/TA_PAGE".*?</svg>\s*</a>'

Get-ChildItem -Filter *.html | ForEach-Object {
    $content = [IO.File]::ReadAllText($_.FullName)
    if ($content -match $pattern) {
        $content = $content -replace $pattern, $newSocialBlock
        [IO.File]::WriteAllText($_.FullName, $content, [System.Text.Encoding]::UTF8)
        Write-Host "Updated $($_.Name)"
    }
}
