import React,{useState,useRef} from 'react';
import {useCreateBlockNote} from '@blocknote/react';
import {BlockNoteView} from '@blocknote/mantine';
import {ru} from '@blocknote/core/locales';
import '@blocknote/mantine/style.css';
import {Button,Form,Descriptions,Space,Tag,Tabs,Typography,Select,Dropdown,Input,Alert,App} from 'antd';
import {ArrowLeftOutlined,PlusOutlined,PictureOutlined,TableOutlined,BoldOutlined,ItalicOutlined,UnderlineOutlined,DownloadOutlined,SaveOutlined,CodeOutlined} from '@ant-design/icons';
import {PageLayout} from '/snapshot/source/admin/src/components/page-layout';
import './document-editor.css';
const cache=new Map();
const clone=(x:any)=>JSON.parse(JSON.stringify(x));
function initial(doc:any){if(doc.isNew)return [{type:"paragraph",content:doc.text}];return [
{type:'paragraph',content:[{type:'text',text:'Назначение документа. ',styles:{bold:true}},{type:'text',text:doc.text,styles:{}}]},
{type:'heading',props:{level:2},content:'Схема расположения'},
{type:'paragraph',content:'Схема — часть документа: её можно переместить между абзацами, заменить изображение и добавить подпись.'},
{type:'image',props:{url:'/library-inline-plan.svg',caption:'Рисунок 1. Учебная схема расположения. Не является рабочей документацией.',previewWidth:640}},
{type:'heading',props:{level:2},content:'Обозначения на схеме'},
{type:'table',content:{type:'tableContent',headerRows:1,rows:[{cells:['Обозначение','Описание','Источник']},{cells:['А','Вход в помещение','Лист 2']},{cells:['Б','Область оборудования','Лист 2']},{cells:['В','Зона обслуживания','Лист 2']}]}},
{type:'heading',props:{level:2},content:'Перед использованием'},
{type:'bulletListItem',content:'Сверьте объект и помещение с заданием.'},
{type:'bulletListItem',content:'Проверьте версию документа и маркировку на исходной схеме.'},
{type:'paragraph',content:[{type:'text',text:'Учебные данные. ',styles:{bold:true}},{type:'text',text:'Фактические планы и инструкции ЖК в этот пример не загружены.',styles:{italic:true}}]}
];}
function ReadOnly({blocks}:any){const e=useCreateBlockNote({initialContent:blocks,dictionary:ru},[blocks]);return <BlockNoteView editor={e} editable={false} theme="light"/>;}
export function DocumentEditor({doc,onMetadataSave,onBack,canEdit=true,startEditing=false}:any){
const {message}=App.useApp();
const [editingMeta,setEditingMeta]=useState(false);
const [metadataForm]=Form.useForm();
const purpose=Form.useWatch('purpose',metadataForm);
const beginMetadata=()=>{metadataForm.setFieldsValue({...doc,description:doc.description||doc.text,purpose:doc.purpose??(doc.kind==='Технический'?'technical':'work')});setEditingMeta(true);};
const saveMetadata=(values:any)=>{const classificationChanged=values.purpose!==(doc.purpose??(doc.kind==='Технический'?'technical':'work'))||values.place!==doc.place||values.room!==doc.room;onMetadataSave?.({...doc,...values,metadataUpdated:new Date().toLocaleString('ru-RU'),...(classificationChanged?{draft:true}:{}),metadataHistory:[...(doc.metadataHistory||[]),{date:new Date().toLocaleString('ru-RU'),author:'Подготовитель · демонстрация'}]});setEditingMeta(false);message.success(classificationChanged?'Метаданные сохранены. Изменение назначения или объекта требует проверки.':'Метаданные сохранены в локальном прототипе');};
const state=useRef(cache.get(doc.id)||{blocks:initial(doc),dirty:false,versions:[{version:doc.version,date:doc.date,label:doc.draft?'Черновик · пример':'Проверена · пример',blocks:initial(doc)}]});
const [mode,setMode]=useState(startEditing&&canEdit?'editor':'preview'),[dirty,setDirty]=useState(state.current.dirty),[versions,setVersions]=useState(state.current.versions),[viewVersion,setViewVersion]=useState<any>(null),[markdown,setMarkdown]=useState<string|null>(null);
const file=useRef<HTMLInputElement>(null);
const upload=async(f:File)=>{if(!['image/png','image/jpeg','image/webp','image/gif'].includes(f.type)||f.size>4*1024*1024)throw new Error('Выберите PNG, JPEG, WebP или GIF до 4 МБ');return await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(f);});};
const editor=useCreateBlockNote({dictionary:ru,initialContent:state.current.blocks,uploadFile:upload},[doc.id]);
const changed=()=>{const dirty=JSON.stringify(editor.document)!==JSON.stringify(state.current.versions[0].blocks);state.current={...state.current,blocks:clone(editor.document),dirty};cache.set(doc.id,state.current);setDirty(dirty);};
const insert=(block:any)=>{const added=editor.insertBlocks([block],editor.getTextCursorPosition().block,'after');editor.setTextCursorPosition(added[0]);editor.focus();};
const addImage=async(e:any)=>{const f=e.target.files?.[0];if(!f)return;try{const url=await upload(f);insert({type:'image',props:{url,caption:f.name,previewWidth:640}});}catch(err:any){message.error(err.message);}finally{e.target.value='';}};
const save=()=>{const entry={version:Math.max(...versions.map((v:any)=>v.version))+1,date:new Date().toLocaleString('ru-RU'),label:'Черновик · локальный пример',blocks:clone(editor.document)};const next=[entry,...versions];state.current={blocks:clone(editor.document),dirty:false,versions:next};cache.set(doc.id,state.current);setVersions(next);setDirty(false);message.success('Версия сохранена в этом просмотре. Публикация не выполнялась.');};
const actions=[{key:'paragraph',label:'Текст'},{key:'heading',label:'Заголовок'},{key:'bulletListItem',label:'Маркированный список'},{key:'numberedListItem',label:'Нумерованный список'},{key:'checkListItem',label:'Чек-лист'},{key:'table',label:'Таблица'},{key:'image',label:'Изображение'}];
const addBlock=(key:string)=>{if(key==='image'){file.current?.click();return;}insert(key==='table'?{type:'table',content:{type:'tableContent',rows:[{cells:['Колонка 1','Колонка 2']},{cells:['','']},{cells:['','']}]}}:{type:key, ...(key==='heading'?{props:{level:2}}:{}),content:''});};
const styles=[{value:'paragraph',label:'Обычный текст'},{value:'h1',label:'Заголовок 1'},{value:'h2',label:'Заголовок 2'},{value:'h3',label:'Заголовок 3'},{value:'bulletListItem',label:'Маркированный список'},{value:'numberedListItem',label:'Нумерованный список'}];
return <PageLayout title={doc.title} actions={<Space wrap><Button icon={<ArrowLeftOutlined/>} onClick={onBack}>Назад</Button><Tag>{doc.place}</Tag><Tag>{doc.system}</Tag><Typography.Text type="secondary">{dirty?'Есть несохранённые изменения':`Версия ${versions[0].version}`} · локальный концепт</Typography.Text></Space>}>
<Tabs activeKey={mode} onChange={v=>{setMode(v);setViewVersion(null);setMarkdown(null);}} items={[{key:'preview',label:'О документе'},{key:'editor',label:canEdit?'Редактор':'Содержимое'},{key:'versions',label:`Версии (${versions.length})`}]}/>
<div className={mode==='editor'?'editor-surface':undefined}>
{mode==='editor'&&canEdit&&<><div className="block-toolbar" role="toolbar" aria-label="Форматирование документа">
<fieldset className="format-controls" disabled={markdown!==null}><Select disabled={markdown!==null} aria-label="Стиль блока" placeholder="Стиль текста" options={styles} onChange={value=>{editor.updateBlock(editor.getTextCursorPosition().block,value.startsWith('h')?{type:'heading',props:{level:Number(value.slice(1)) as any}}:{type:value as any});editor.focus();}}/>
{[['bold',BoldOutlined,'Жирный'],['italic',ItalicOutlined,'Курсив'],['underline',UnderlineOutlined,'Подчёркнутый']].map(([key,Icon,label]:any)=><Button key={key} aria-label={label} title={label} icon={<Icon/>} onMouseDown={e=>e.preventDefault()} onClick={()=>{editor.toggleStyles({[key]:true});editor.focus();}}/>)}
</fieldset>
<Button className="source-button" icon={<CodeOutlined/>} type={markdown!==null?'primary':'default'} aria-pressed={markdown!==null} onClick={async()=>setMarkdown(markdown===null?await editor.blocksToMarkdownLossy(editor.document):null)}>Исходник</Button><Button icon={<DownloadOutlined/>} onClick={async()=>{const source=markdown??await editor.blocksToMarkdownLossy(editor.document);const url=URL.createObjectURL(new Blob([source],{type:'text/markdown'}));const a=document.createElement('a');a.href=url;a.download='document.md';a.click();URL.revokeObjectURL(url);}}>Скачать .md</Button><Button type="primary" disabled={!dirty} icon={<SaveOutlined/>} onClick={save}>Сохранить версию</Button></div><input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={addImage} hidden/><p className="editor-hint">Выделите текст для форматирования · / — добавить блок</p></>}
{mode==='preview'?<section className="document-metadata" aria-label="Метаданные документа"><div className="metadata-heading"><Typography.Title level={4}>О документе</Typography.Title>{canEdit&&!editingMeta&&<Button onClick={beginMetadata}>Редактировать</Button>}</div>{editingMeta?<Form form={metadataForm} layout="vertical" onFinish={saveMetadata} className="metadata-form">
<Form.Item name="title" label="Название" rules={[{required:true,whitespace:true,message:'Укажите название'}]}><Input/></Form.Item>
<Form.Item name="description" label="Описание"><Input.TextArea rows={3}/></Form.Item>
<Form.Item name="purpose" label="Назначение" rules={[{required:true,message:'Выберите назначение'}]}><Select options={[{value:'technical',label:'Техническая документация'},{value:'work',label:'Документ по работе / обращению'}]}/></Form.Item>
<Alert type="info" message={purpose==='technical'?'Все документы → Техническая библиотека':purpose==='work'?'Все документы':'Выберите назначение'} description={purpose==='technical'?'Исполнители увидят документ в библиотеке после проверки. Назначение не расширяет права доступа.':'Документ остаётся в общем списке; в техническую библиотеку не включается.'}/>
<div className="metadata-grid"><Form.Item name="kind" label="Тип документа" rules={[{required:true,message:'Выберите тип'}]}><Select options={['План','Схема','Инструкция','Паспорт','Акт','Отчёт','Технический'].map(value=>({value,label:value}))}/></Form.Item>
<Form.Item name="place" label="Дом / территория" rules={[{required:true,message:'Выберите объект'}]}><Select options={['Весь ЖК','Дом 12','Дом 3'].map(value=>({value,label:value}))}/></Form.Item>
<Form.Item name="room" label="Помещение / зона"><Input placeholder="Например, техническое помещение"/></Form.Item>
{purpose==='technical'&&<><Form.Item name="system" label="Инженерная система"><Select options={['План ЖК','Электрика','Водоснабжение','Отопление','Другое'].map(value=>({value,label:value}))}/></Form.Item><Form.Item name="owner" label="Ответственный за актуальность"><Select allowClear options={[{value:'Подготовитель · демонстрация',label:'Подготовитель · демонстрация'},{value:'Проверяющий · демонстрация',label:'Проверяющий · демонстрация'}]}/></Form.Item><Form.Item name="reviewAt" label="Следующая проверка"><Input type="date"/></Form.Item></>}</div>
<Space><Button type="primary" htmlType="submit">Сохранить метаданные</Button><Button onClick={()=>setEditingMeta(false)}>Отменить</Button></Space><p className="secondary">Автор и дата создания определяются автоматически. Изменения сохраняются только в этом просмотре.</p>
</Form>:<><Descriptions column={1} colon={false} items={[
{key:'title',label:'Название',children:doc.title},
{key:'description',label:'Описание',children:doc.description||doc.text||'Не заполнено'},
{key:'author',label:'Автор',children:doc.author||'Не указан'},
{key:'place',label:'Дом / территория',children:doc.place},
{key:'room',label:'Помещение / зона',children:doc.room==='—'?'Не указано':doc.room||'Не указано'},
{key:'system',label:'Инженерная система',children:doc.system},
{key:'purpose',label:'Назначение',children:(doc.purpose??(doc.kind==='Технический'?'technical':'work'))==='technical'?'Техническая документация · Все документы и библиотека':'Документ по работе / обращению · Все документы'},
{key:'kind',label:'Тип документа',children:doc.kind||'Не указан'},
{key:'status',label:'Статус',children:<Tag>{doc.draft?'Черновик · требуется проверка':dirty?'Есть изменения':versions[0].label}</Tag>},
{key:'version',label:'Текущая версия',children:versions[0].version||'Ещё не сохранена'},
{key:'created',label:'Создан',children:doc.createdAt||'Не указано'},
{key:'updated',label:'Дата версии',children:versions[0].date},
{key:'owner',label:'Ответственный за актуальность',children:doc.owner||'Не назначен'},
{key:'review',label:'Следующая проверка',children:doc.reviewAt||'Не назначена'},
{key:'source',label:'Источник',children:doc.isNew?'Создан в редакторе':'Учебный документ · исходный файл не прикреплён'}
]}/>{doc.metadataUpdated&&<Typography.Paragraph type="secondary">Метаданные изменены: {doc.metadataUpdated} · Подготовитель (демонстрация)</Typography.Paragraph>}<Typography.Paragraph type="secondary">Содержимое документа — во вкладке «{canEdit?'Редактор':'Содержимое'}», предыдущие редакции — во вкладке «Версии».</Typography.Paragraph></>}</section>:mode!=='versions'?<div className="document-paper">{markdown!==null&&mode==='editor'?<Input.TextArea className="document-markdown" aria-label="Markdown документа" value={markdown} readOnly autoSize={{minRows:24}}/>:<BlockNoteView editor={editor} editable={mode==='editor'&&canEdit} theme="light" onChange={changed}/>}</div>:<div className="version-layout"><div className="version-list"><Typography.Title level={4}>История документа</Typography.Title><p className="secondary">Каждая версия содержит текст, таблицы и изображения вместе.</p>{versions.map((v:any)=><button className={viewVersion===v?'version-item selected':'version-item'} key={v.version} onClick={()=>setViewVersion(v)}><strong>Версия {v.version}</strong><span>{v.label}</span><small>{v.date}</small></button>)}</div><div>{viewVersion?<><Space wrap className="version-heading"><Tag>Просмотр версии {viewVersion.version}</Tag>{canEdit&&<Button onClick={()=>{editor.replaceBlocks(editor.document,clone(viewVersion.blocks));changed();setMode('editor');setViewVersion(null);}}>Создать черновик из этой версии</Button>}</Space><div className="document-paper"><ReadOnly blocks={viewVersion.blocks}/></div></>:<Alert type="info" message="Выберите версию для просмотра" description="Просмотр истории не меняет текущий черновик."/>}</div></div>}

</div>
</PageLayout>;
}
