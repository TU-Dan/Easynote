# 轻松记 Supabase 数据库配置

1. 在 Supabase 创建一个项目。
2. 打开 Supabase SQL Editor，执行 `supabase.sql`。
3. 在 Project Settings -> API 里复制：
   - Project URL
   - anon public key
4. 把它们填入 `supabase-config.js`：

```js
export const SUPABASE_CONFIG = {
  url: 'https://xxxx.supabase.co',
  anonKey: 'eyJ...'
}
```

5. 在 Authentication -> Providers 里启用 Email，并允许邮箱密码注册登录。
6. 在 Authentication -> URL Configuration 里加入线上域名作为 Site URL / Redirect URL。
7. 部署应用。
8. 用户打开轻松记后，先注册账号或登录账号。
9. 登录后，记录、今日总结、看板和 AI 接口设置都会按用户 ID 存进 Supabase。

数据表：

- `public.qsj_entries`：用户记录
- `public.qsj_summaries`：每日总结
- `public.qsj_kanban_cards`：看板卡片
- `public.qsj_user_settings`：每个用户的 AI 接口设置

每张表都有 `user_id`，并使用 Supabase Auth 的 RLS 策略限制为“只能读写自己的数据”。同一个项目可以承载多个用户，每个用户的数据按自己的 Supabase Auth 用户 ID 隔离。
