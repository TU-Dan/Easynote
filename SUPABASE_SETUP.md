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

5. 部署应用。
6. 用户打开轻松记 -> 设置，只需要输入自己的同步邮箱，点击“发送登录邮件”。
7. 手机和电脑都用同一个邮箱登录后，记录、今日总结、看板和 AI 接口设置会同步。

数据表：

- `public.qsj_entries`：用户记录
- `public.qsj_summaries`：每日总结
- `public.qsj_kanban_cards`：看板卡片
- `public.qsj_user_settings`：每个用户的 AI 接口设置

每张表都有 `user_id`，并使用 Supabase Auth 的 RLS 策略限制为“只能读写自己的数据”。同一个项目可以承载多个用户，每个用户的数据按自己的 Supabase Auth 用户 ID 隔离。
