import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Link} from 'react-router-dom';
import {ConfigProvider,App,Alert} from 'antd';
import {HomePage} from '/snapshot/source/admin/src/pages/home';
import {RequestsPage} from '/snapshot/source/admin/src/pages/requests';
import {cabinetTheme} from '/snapshot/source/admin/src/lib/cabinet-theme';
import '/snapshot/source/admin/src/styles/cabinet.css';
createRoot(document.getElementById('root')!).render(<ConfigProvider theme={cabinetTheme('green')}><App><BrowserRouter><div style={{maxWidth:1320,margin:'auto',padding:16}}><Alert message="Локальная проверка интерфейса · демонстрационные данные · без ключа — демонстрационный ответ AI" type="info"/><Link to="/dashboard-browser.html">Главная</Link> · <a href="/library-v3.html?page=docs">Концепт библиотеки исполнителя</a><Routes><Route path="/dashboard-browser.html" element={<HomePage/>}/><Route path="/requests" element={<RequestsPage/>}/></Routes></div></BrowserRouter></App></ConfigProvider>);
