<?php
declare(strict_types=1);
require __DIR__ . '/auth.php';

function asset(string $path): string
{
    $file = __DIR__ . '/' . $path;
    $version = is_file($file) ? (string) filemtime($file) : '1';
    return htmlspecialchars("{$path}?v={$version}", ENT_QUOTES, 'UTF-8');
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

if (auth_user() !== null) {
    header('Location: index.php', true, 302);
    exit;
}

$error = null;
$email = '';
$notice = null;

if (($_GET['expired'] ?? '') === '1') {
    $notice = 'Your session ended. Sign in to continue.';
} elseif (($_GET['signed_out'] ?? '') === '1') {
    $notice = 'You’re signed out.';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $email = (string) ($_POST['email'] ?? '');
    $password = (string) ($_POST['password'] ?? '');
    $notice = null;

    if (!auth_check_csrf($_POST['csrf'] ?? null)) {
        $error = 'This form expired. Try again.';
    } elseif (trim($email) === '' || $password === '') {
        $error = 'Enter your email and password.';
    } else {
        $error = auth_attempt($email, $password);
        if ($error === null) {
            header('Location: index.php', true, 303);
            exit;
        }
    }
    http_response_code(401);
}

$csrf = auth_csrf_token();
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#202522">
    <meta name="robots" content="noindex">
    <title>Sign in · Chili Finance</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= asset('assets/styles.css') ?>">
</head>
<body class="login-body">
    <div class="login-shell">
        <aside class="login-aside">
            <span class="brand">
                <span class="brand-mark">C</span>
                <span>CHILI<small>FINANCE</small></span>
            </span>
            <div class="login-aside-copy">
                <p class="eyebrow">Finance control room</p>
                <p class="login-lede">Invoices, MRR, retention and margin across Brazil, Mexico, Panama and International, in one USD view.</p>
            </div>
            <p class="sidebar-note">Access is limited to the finance team.</p>
        </aside>

        <main class="login-main">
            <form class="login-form" method="post" action="login.php" novalidate>
                <h1>Sign in</h1>
                <p class="login-copy">Use your finance workspace account.</p>

                <?php if ($notice !== null): ?>
                    <p class="notice is-info login-notice" role="status"><?= e($notice) ?></p>
                <?php endif; ?>

                <input type="hidden" name="csrf" value="<?= e($csrf) ?>">

                <label class="field">
                    <span>Email</span>
                    <input type="email" name="email" value="<?= e($email) ?>" autocomplete="username" required <?= $error !== null ? 'aria-invalid="true" aria-describedby="login-error"' : '' ?> <?= $email === '' ? 'autofocus' : '' ?>>
                </label>

                <label class="field">
                    <span>Password</span>
                    <input type="password" name="password" autocomplete="current-password" required <?= $error !== null ? 'aria-invalid="true" aria-describedby="login-error" autofocus' : '' ?>>
                </label>

                <?php if ($error !== null): ?>
                    <p class="form-error" id="login-error" role="alert"><?= e($error) ?></p>
                <?php endif; ?>

                <button type="submit" class="button-primary login-submit">Sign in</button>
            </form>
        </main>
    </div>
    <script>
        document.querySelector('.login-form').addEventListener('submit', (event) => {
            const button = event.currentTarget.querySelector('.login-submit');
            if (button.disabled) { event.preventDefault(); return; }
            button.disabled = true;
            button.textContent = 'Signing in…';
        });
    </script>
</body>
</html>