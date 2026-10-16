import {assertEquals} from "@std/assert";
import {encodeWorkbook,decodeWorkbook} from "../../core/src/domains/registry/workbook.ts";
Deno.test("VS-2: XLSX в Deno без файловой/системной привилегии",async()=>{
 const bytes=await encodeWorkbook();
 const workbook=await decodeWorkbook(bytes);
 assertEquals(workbook,{buildings:[],premises:[],persons:[],connections:[]});
});
