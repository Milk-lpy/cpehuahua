export type HuaweiXmlValue = string | HuaweiXmlObject | HuaweiXmlValue[];

export interface HuaweiXmlObject {
  [key: string]: HuaweiXmlValue;
}

export interface HuaweiError {
  code: number | null;
  rawCode: string | null;
  message: string | null;
}

export interface ParsedHuaweiXml {
  rawXml: string;
  rootName: string | null;
  data: HuaweiXmlObject | null;
  response: HuaweiXmlObject;
  fields: string[];
  error: HuaweiError | null;
  parseError: string | null;
}
