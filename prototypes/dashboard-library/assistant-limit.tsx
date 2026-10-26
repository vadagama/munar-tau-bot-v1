import React from 'react';
import {createRoot} from 'react-dom/client';
import {ConfigProvider} from 'antd';
import {HomeAssistant} from '/snapshot/source/admin/src/pages/home-assistant';
createRoot(document.getElementById('root')!).render(<ConfigProvider><main style={{maxWidth:900,margin:'40px auto',padding:20,fontFamily:'system-ui'}}><h1>AI-ассистент</h1><HomeAssistant status={{state:'limit',remaining:0,daily_limit:20}}/></main></ConfigProvider>);
