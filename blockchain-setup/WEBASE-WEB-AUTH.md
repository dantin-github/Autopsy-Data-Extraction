# WeBASE: Adding Node Front via Web UI or API

## Why "user not logged in" (302000)?

The WeBASE Node-Manager API requires authentication. Direct `curl` calls without a session return:

```json
{"code":302000,"message":"user not logged in","data":null}
```

## Recommended: Add Node via Web UI

1. Open http://localhost:5000
2. Log in with **admin** / **Abcd1234**
3. Go to **Chain Management** (or **节点管理**)
4. Add a new node front:
   - IP: `127.0.0.1`
   - Port: `5002`

This avoids the API auth flow and captcha.

---

## Alternative: Add Front via API (with login)

If you need to script it, use this flow:

### 1. Get captcha and token

```bash
curl -s "http://127.0.0.1:5001/WeBASE-Node-Manager/account/pictureCheckCode" | jq .
```

Save the `token` from the response. Optionally decode `base64Image` to see the captcha:

```bash
# Save image to file
curl -s "http://127.0.0.1:5001/WeBASE-Node-Manager/account/pictureCheckCode" | jq -r '.data.base64Image' | base64 -d > /tmp/captcha.png
# Open and read the code
```

### 2. Login (use token from step 1)

Replace `YOUR_TOKEN` and `CHECK_CODE` (the characters you see in the captcha image):

```bash
curl -v -c cookies.txt -X GET \
  "http://127.0.0.1:5001/WeBASE-Node-Manager/account/login?checkCode=CHECK_CODE" \
  -H "Content-Type: application/json;token:YOUR_TOKEN" \
  -d '{"account":"admin","accountPwd":"Abcd1234"}'
```

The `-c cookies.txt` saves the session cookie. Use `-v` to confirm a successful login (code 0).

### 3. Add front (with saved cookie)

```bash
curl -X POST "http://127.0.0.1:5001/WeBASE-Node-Manager/front/new" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"frontIp":"127.0.0.1","frontPort":5002}'
```

---

## If "network_organization_mapping not exist"

This usually means the Node-Manager database schema is incomplete. Run upgrade scripts:

```bash
cd ~/webase-deploy/webase-node-mgr/script
# Check for upgrade SQL files and run them against the MySQL database
mysql -h 127.0.0.1 -P 23306 -u root -p123456 webasenodemanager < upgrade_*.sql
```

Adjust host/port/user/password to match your `common.properties` MySQL config.

---

## Front Status "Unusual" (异常)

When the front shows **Unusual** in the node list, Node-Manager cannot reach or verify the WeBASE-Front service. Common causes:

### 1. FISCO chain nodes not running

WeBASE-Front connects to the chain; if nodes are stopped, the front becomes unhealthy.

```bash
cd ~/fisco && bash nodes/127.0.0.1/start_all.sh
# Wait a few seconds, then restart WeBASE
cd ~/webase-deploy && python3 deploy.py stopAll && sleep 3 && python3 deploy.py startAll
```

### 2. Startup order after reboot

Always start in this order:

1. FISCO nodes
2. MySQL (Docker)
3. WeBASE services

```bash
cd ~/fisco && bash nodes/127.0.0.1/start_all.sh
docker start webase-mysql && sleep 20
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
cd ~/webase-deploy && python3 deploy.py startAll
```

### 3. WeBASE-Front not reachable on 5002

Check that the front is listening:

```bash
curl -s http://127.0.0.1:5002/WeBASE-Front/1/blockNumber
```

If this fails, check `~/webase-deploy/webase-front/conf/application.yml`:
- `constant.peers` or `sdk.peers` should include `127.0.0.1:20200` (and 20201, 20202, 20203 for multi-node)
- `constant.certPath` should point to SDK certs copied from `~/fisco/nodes/127.0.0.1/sdk/`

### 4. Click "Refresh" in the Front list

After fixing the above, click the refresh button in the node management page; status may update to normal.
