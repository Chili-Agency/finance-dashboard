<?php
declare(strict_types=1);

/*
 * Autenticação do dashboard.
 *
 * TEMPORÁRIO: as credenciais abaixo são mockadas em código. Quando houver
 * uma fonte real (tabela de usuários, SSO etc.), troque apenas
 * auth_find_user() — o resto (sessão, guardas, CSRF) continua valendo.
 */

const AUTH_MOCK_USERS = [
    'admin@chili.pa' => [
        'password' => 'Chili@2026',
        'name' => 'Finance Admin',
    ],
];

const AUTH_SESSION_NAME = 'chili_finance_session';
const AUTH_IDLE_SECONDS = 8 * 60 * 60;
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_LOCK_SECONDS = 5 * 60;

function auth_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

    session_name(AUTH_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    session_start();
}

function auth_find_user(string $email): ?array
{
    $email = strtolower(trim($email));
    return AUTH_MOCK_USERS[$email] ?? null;
}

function auth_user(): ?array
{
    auth_start();
    $user = $_SESSION['auth_user'] ?? null;
    if (!is_array($user)) {
        return null;
    }
    $last = (int) ($_SESSION['auth_last_seen'] ?? 0);
    if (time() - $last > AUTH_IDLE_SECONDS) {
        auth_logout();
        return null;
    }
    $_SESSION['auth_last_seen'] = time();
    return $user;
}

function auth_attempt(string $email, string $password): ?string
{
    auth_start();
    $lockedUntil = (int) ($_SESSION['auth_locked_until'] ?? 0);
    if ($lockedUntil > time()) {
        $minutes = (int) ceil(($lockedUntil - time()) / 60);
        return "Too many attempts. Try again in {$minutes} minute" . ($minutes === 1 ? '' : 's') . '.';
    }

    $user = auth_find_user($email);
    $expected = $user['password'] ?? bin2hex(random_bytes(16));
    $valid = $user !== null && hash_equals($expected, $password);

    if (!$valid) {
        $attempts = (int) ($_SESSION['auth_attempts'] ?? 0) + 1;
        $_SESSION['auth_attempts'] = $attempts;
        if ($attempts >= AUTH_MAX_ATTEMPTS) {
            $_SESSION['auth_attempts'] = 0;
            $_SESSION['auth_locked_until'] = time() + AUTH_LOCK_SECONDS;
        }
        return 'That email and password don’t match.';
    }

    session_regenerate_id(true); // evita session fixation
    unset($_SESSION['auth_attempts'], $_SESSION['auth_locked_until']);
    $_SESSION['auth_user'] = ['email' => strtolower(trim($email)), 'name' => $user['name']];
    $_SESSION['auth_last_seen'] = time();
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    return null;
}

function auth_logout(): void
{
    auth_start();
    $_SESSION = [];
    $params = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires' => time() - 3600,
        'path' => $params['path'],
        'secure' => $params['secure'],
        'httponly' => $params['httponly'],
        'samesite' => $params['samesite'] ?: 'Lax',
    ]);
    session_destroy();
}

function auth_csrf_token(): string
{
    auth_start();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function auth_check_csrf(?string $token): bool
{
    auth_start();
    return is_string($token) && !empty($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

function auth_require_page(): array
{
    $user = auth_user();
    if ($user === null) {
        header('Location: login.php', true, 302);
        exit;
    }
    auth_csrf_token();
    session_write_close();
    return $user;
}

function auth_require_api(): array
{
    $user = auth_user();
    if ($user === null) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode(['error' => 'Your session has ended. Sign in again.', 'auth' => false]);
        exit;
    }
    session_write_close();
    return $user;
}