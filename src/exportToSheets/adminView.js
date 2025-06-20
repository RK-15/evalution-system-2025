const { google } = require('googleapis');
const { auth, fetchKintoneRecords } = require('./utils');
require('dotenv').config();

const ADMIN_VIEW_TEMPLATE_FILE_ID = process.env.ADMIN_VIEW_TEMPLATE_FILE_ID;

const exportToSheetGeneral = async (evaluationPeriod, { multiRecords, selfRecords, averageRecords }, periodFolderId) => {
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // テンプレートをコピー
    const copyResponse = await drive.files.copy({
        fileId: ADMIN_VIEW_TEMPLATE_FILE_ID,
        requestBody: {
            name: `（管理者）多面評価閲覧`,
            parents: [periodFolderId]
        }
    });

    const spreadsheetId = copyResponse.data.id;

    // テンプレートシートを取得
    const templateSheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
    const templateSheetId = templateSheetMeta.data.sheets.find(s => s.properties.title === 'テンプレート')?.properties.sheetId;

    // 社員名の一意リストを取得
    const employeeNames = [
        // 重複チェック
        ...new Set([
            ...selfRecords.map(r => r.name?.value),
            ...multiRecords.map(r => r.created_by?.value?.name),
            ...averageRecords.map(r => r.select_employee?.value?.[0]?.name)
        ].filter(Boolean))
    ];

    //  全社員分ループ
    for (const name of employeeNames) {
        // 「テンプレート」シートをコピー
        const copiedSheet = await sheets.spreadsheets.sheets.copyTo({
            spreadsheetId,
            sheetId: templateSheetId,
            requestBody: {
                destinationSpreadsheetId: spreadsheetId
            }
        });

        const sheetId = copiedSheet.data.sheetId;
        const sheetName = name;

        // 自己評価入力から抽出
        const targetRecord = selfRecords.find(r =>
            r.name?.value === name &&
            r.evaluation_period?.value === evaluationPeriod
        );

        // C8〜I8: 自己評価入力フィールド
        const selfValues = targetRecord ? [[
            targetRecord.root?.value || '',
            targetRecord.grade?.value || '',
            targetRecord.skill?.value || '',
            targetRecord.business?.value || '',
            targetRecord.team_management?.value || '',
            targetRecord.total_average?.value || '',
            targetRecord.comment?.value || ''
        ]] : [['', '', '', '', '', '', '']];

        // 評価集計から抽出
        const targetAverageRecord = averageRecords.find(r =>
            r.select_employee?.value?.[0]?.name === name &&
            r.evaluation_period?.value === evaluationPeriod
        );

        // E9～H9: 評価平均フィールド
        const averageValues = targetAverageRecord ? [[
            targetAverageRecord.evaluation_skill?.value || '',
            targetAverageRecord.evaluation_business?.value || '',
            targetAverageRecord.evaluation_management?.value || '',
            targetAverageRecord.other_evaluation?.value || ''
        ]] : [['', '', '', '']];

        // B9～I9: 多面評価入力から抽出
        const additionalInputRows = multiRecords
            .filter(r =>
                r.select_employee?.value?.[0]?.name === name &&
                r.evaluation_period?.value === evaluationPeriod
            )
            .map(r => {
                return [
                    r.created_by?.value?.name || '',
                    r.creater_route?.value || '',
                    r.creater_grade?.value || '',
                    r.skill?.value || '',
                    r.business?.value || '',
                    r.team_management?.value || '',
                    r.other_evaluation?.value || '',
                    r.comment?.value || ''
                ];
            });

        // コピー後のシート名を変更
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        updateSheetProperties: {
                            properties: {
                                sheetId,
                                title: sheetName
                            },
                            fields: 'title'
                        }
                    }
                ]
            }
        });

        // 書き込みデータ
        const data = [
            {
                range: `${sheetName}!C3`,
                values: [[evaluationPeriod]]
            },
            {
                range: `${sheetName}!C4`,
                values: [[name]]
            },
            {
                range: `${sheetName}!C8:I8`,
                values: selfValues
            },
            {
                range: `${sheetName}!E9:H9`,
                values: averageValues
            }
        ];

        if (additionalInputRows.length > 0) {
            data.push({
                range: `${sheetName}!B10:I${9 + additionalInputRows.length}`,
                values: additionalInputRows
            });
        }

        // 一括更新
        try {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data
                }
            });

            console.log(`✅ 管理者シート: ${name} - ${evaluationPeriod} 完了`);
        } catch (error) {
            console.error(`❌ ${name} の出力中にエラー`, error);
        }
    }

    try {
        // テンプレートシートを削除
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        deleteSheet: {
                            sheetId: templateSheetId
                        }
                    }
                ]
            }
        });
        console.log('🗑️ テンプレートシート削除完了');

    } catch (error) {
        console.log('❌ テンプレートシート削除中のエラー');
    }
};

module.exports = exportToSheetGeneral;
