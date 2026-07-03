<?php
/**
 * Split a PHP source file into ordered segments using the real PHP tokenizer.
 * Reads source from STDIN, writes JSON to STDOUT:
 *   [{"t":"html","v":"...raw..."}, {"t":"php","v":"...raw..."}, ...]
 *
 * Concatenating all segment "v" values reproduces the original file byte-for-byte.
 * T_INLINE_HTML tokens are the literal HTML between PHP tags; everything else
 * (including <?php, <?=, ?>, and all code) is classified as "php" and must be
 * preserved verbatim — we never translate it.
 */
error_reporting(0);
$src = stream_get_contents(STDIN);
if ($src === false) { fwrite(STDERR, "no input\n"); exit(2); }

$tokens = token_get_all($src);
$segments = [];
$curType = null;
$buf = '';

function flush_seg(&$segments, &$curType, &$buf) {
    if ($curType !== null && $buf !== '') {
        $segments[] = ['t' => $curType, 'v' => $buf];
    }
    $buf = '';
}

foreach ($tokens as $tok) {
    if (is_array($tok)) {
        $id = $tok[0];
        $text = $tok[1];
        $type = ($id === T_INLINE_HTML) ? 'html' : 'php';
    } else {
        // single-character token (e.g. ';', '{', '}') — always PHP code
        $text = $tok;
        $type = 'php';
    }
    if ($type !== $curType) {
        flush_seg($segments, $curType, $buf);
        $curType = $type;
    }
    $buf .= $text;
}
flush_seg($segments, $curType, $buf);

echo json_encode($segments, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
